import React, { useState, useEffect } from 'react';
import {
  Settings,
  Store,
  CreditCard,
  Printer,
  Sliders,
  Lock,
  Database,
  Shield,
  Save,
  CheckCircle,
  Download,
  Upload,
  RefreshCw,
  Search,
  History,
  AlertTriangle,
  FileText,
  Key,
  Globe,
  Radio,
  Eye,
  EyeOff,
  Copy,
  ExternalLink,
  Zap,
  DollarSign,
  QrCode,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  FolderTree,
} from 'lucide-react';
import { collection, doc, getDocs, onSnapshot, setDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from '../../firebase';
import { PaymentGatewaySettings } from '../settings/PaymentGatewaySettings';
import { getServerToken } from '../../services/firebaseSession';
import { logAudit } from '../../services/posRuntime';
import { printReceipt, receiptLines } from '../../services/receiptPrinter';
import { useLanguage } from '../../context/LanguageContext';
import { query as fsQuery, orderBy as fsOrderBy, limit as fsLimit } from 'firebase/firestore';
import { useAppNavigation } from '../../router';
import { useFirestoreList } from '../../hooks/useFirestoreList';
import { resetAllDatabaseData } from '../../services/dataSeeder';
import { SidebarMenuBuilder } from '../admin/SidebarMenuBuilder';

interface POSSettingsModuleProps {
  subModule:
    | 'menu'
    | 'umum'
    | 'toko'
    | 'pembayaran'
    | 'printer_struk'
    | 'global_setup'
    | 'hak_akses'
    | 'backup_restore'
    | 'payment_gateway'
    | 'audit_log';
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string) => void;
}

export const POSSettingsModule: React.FC<POSSettingsModuleProps> = ({
  subModule,
  currencyMode = 'IDR',
  onNavigateTab,
}) => {
  const { route, navigateTab } = useAppNavigation();
  const activeSub = (
    route.activeTab === 'module_pos_settings' ? route.activeSubModule : subModule
  ) as
    | 'menu'
    | 'umum'
    | 'toko'
    | 'pembayaran'
    | 'printer_struk'
    | 'global_setup'
    | 'hak_akses'
    | 'backup_restore'
    | 'payment_gateway'
    | 'audit_log';
  const setActiveSub = (
    next:
      | 'menu'
      | 'umum'
      | 'toko'
      | 'pembayaran'
      | 'printer_struk'
      | 'global_setup'
      | 'hak_akses'
      | 'backup_restore'
      | 'payment_gateway'
      | 'audit_log'
  ) => {
    navigateTab('module_pos_settings', next);
  };

  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [logRefreshed, setLogRefreshed] = useState(false);
  const [showMaskedKeys, setShowMaskedKeys] = useState(false);
  const [pingTesting, setPingTesting] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);

  // Database Wipe / Reset State
  const [isResettingDb, setIsResettingDb] = useState(false);
  const [resetDbFeedback, setResetDbFeedback] = useState<string | null>(null);
  const [showConfirmResetModal, setShowConfirmResetModal] = useState(false);

  // ================= 1. UMUM =================
  const [autoLockMinutes, setAutoLockMinutes] = useState(10);
  const [barcodeEnterSubmits, setBarcodeEnterSubmits] = useState(true);
  const [soundBeepEnabled, setSoundBeepEnabled] = useState(true);
  const [allowManualCashierDiscount, setAllowManualCashierDiscount] = useState(false);
  const [maxCashierDiscountPct, setMaxCashierDiscountPct] = useState(10);
  const [autoOpenCashDrawerOnCash, setAutoOpenCashDrawerOnCash] = useState(true);

  // ================= 2. TOKO =================
  const [selectedOutlet, setSelectedOutlet] = useState('OUT-01');
  const [storeName, setStoreName] = useState('RiskCart Official POS - Cabang Kelapa Gading');
  const [storeAddress, setStoreAddress] = useState('Jl. Boulevard Raya Blok QF1 No. 12, Kelapa Gading, Jakarta Utara');
  const [storePhone, setStorePhone] = useState('(021) 4587-9922');
  const [storeTaxNumber, setStoreTaxNumber] = useState('01.234.567.8-012.000');
  const [storeFooterNote, setStoreFooterNote] = useState('Terima kasih telah berbelanja di RiskCart! Barang yang sudah dibeli tidak dapat ditukar tanpa bukti struk resmi.');

  // ================= 3. PEMBAYARAN =================
  const [acceptCash, setAcceptCash] = useState(true);
  const [acceptQris, setAcceptQris] = useState(true);
  const [acceptEdc, setAcceptEdc] = useState(true);
  const [acceptKasbon, setAcceptKasbon] = useState(true);
  const [acceptCod, setAcceptCod] = useState(true);
  const [roundingEnabled, setRoundingEnabled] = useState(true);
  const [cashRoundingMode, setCashRoundingMode] = useState<'none' | 'floor_100' | 'ceil_500'>('floor_100');
  const [maxCashDrawerAlert, setMaxCashDrawerAlert] = useState(3000000); // 3jt warning
  const [requireCashCountOnShiftClose, setRequireCashCountOnShiftClose] = useState(true);

  // ================= 4. PRINTER STRUK =================
  const [printerInterface, setPrinterInterface] = useState<'bluetooth' | 'usb' | 'network'>('usb');
  const [printerPaperSize, setPrinterPaperSize] = useState<'58mm' | '80mm'>('80mm');
  const [networkPrinterIp, setNetworkPrinterIp] = useState('192.168.1.200');
  const [networkPrinterPort, setNetworkPrinterPort] = useState('9100');
  const [autoCutPaper, setAutoCutPaper] = useState(true);
  const [printCopies, setPrintCopies] = useState<1 | 2>(1);
  const [printStoreLogo, setPrintStoreLogo] = useState(true);
  const [printTaxDetail, setPrintTaxDetail] = useState(true);
  const [printCustomerPoints, setPrintCustomerPoints] = useState(true);
  const [printReceiptBarcode, setPrintReceiptBarcode] = useState(true);

  // ================= 5. GLOBAL SETUP =================
  const [defaultCurrency, setDefaultCurrency] = useState<'IDR' | 'USD'>('IDR');
  const [systemTimezone, setSystemTimezone] = useState('Asia/Jakarta (WIB)');
  const [taxEnabled, setTaxEnabled] = useState(true);
  const [defaultTaxRate, setDefaultTaxRate] = useState(11); // PPN 11%
  const [serviceChargeRate, setServiceChargeRate] = useState(0);
  const [skuPrefixFormat, setSkuPrefixFormat] = useState('RC-SEM-{RAND4}');
  const [lowStockDefaultAlert, setLowStockDefaultAlert] = useState(10);

  // ================= 6. HAK DAN AKSES =================
  const [requireSupervisorPinForVoid, setRequireSupervisorPinForVoid] = useState(true);
  const [requirePinForDrawerKick, setRequirePinForDrawerKick] = useState(true);
  const [requirePinForReprintOld, setRequirePinForReprintOld] = useState(false);
  // PIN tidak pernah disimpan plaintext: dikirim ke /api/settings/pin (SHA-256 + salt di server)
  const [supervisorPin, setSupervisorPin] = useState('');
  const [managerPin, setManagerPin] = useState('');

  // ================= 7. BACKUP AND RESTORE =================
  const { data: backupSnapshots } = useFirestoreList<any>('backup_snapshots', []);

  // ================= 9. AUDIT LOG =================
  const { data: auditLogs } = useFirestoreList<any>('audit_logs', []);
  const { setCurrencyMode } = useLanguage();

  // Transaksi terakhir untuk preview & test print struk (data asli)
  const [lastTx, setLastTx] = useState<any>(null);
  useEffect(() => {
    return onSnapshot(
      fsQuery(collection(db, 'transactions'), fsOrderBy('createdAt', 'desc'), fsLimit(1)),
      (snap) => setLastTx(snap.docs[0] ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null),
      () => {}
    );
  }, []);

  useEffect(() => {
    const applyDocData = (d: any) => {
      if (!d) return;
      if (d.selectedOutlet !== undefined) setSelectedOutlet(d.selectedOutlet);
      if (d.storeName !== undefined) setStoreName(d.storeName);
      if (d.storeAddress !== undefined) setStoreAddress(d.storeAddress);
      if (d.storePhone !== undefined) setStorePhone(d.storePhone);
      if (d.storeTaxNumber !== undefined) setStoreTaxNumber(d.storeTaxNumber);
      if (d.storeFooterNote !== undefined) setStoreFooterNote(d.storeFooterNote);
      if (d.autoLockMinutes !== undefined) setAutoLockMinutes(d.autoLockMinutes);
      if (d.barcodeEnterSubmits !== undefined) setBarcodeEnterSubmits(d.barcodeEnterSubmits);
      if (d.soundBeepEnabled !== undefined) setSoundBeepEnabled(d.soundBeepEnabled);
      if (d.allowManualCashierDiscount !== undefined) setAllowManualCashierDiscount(d.allowManualCashierDiscount);
      if (d.maxCashierDiscountPct !== undefined) setMaxCashierDiscountPct(d.maxCashierDiscountPct);
      if (d.autoOpenCashDrawerOnCash !== undefined) setAutoOpenCashDrawerOnCash(d.autoOpenCashDrawerOnCash);
      if (d.acceptCash !== undefined) setAcceptCash(d.acceptCash);
      if (d.acceptQris !== undefined) setAcceptQris(d.acceptQris);
      if (d.acceptEdc !== undefined) setAcceptEdc(d.acceptEdc);
      if (d.acceptKasbon !== undefined) setAcceptKasbon(d.acceptKasbon);
      if (d.acceptCod !== undefined) setAcceptCod(d.acceptCod);
      if (d.roundingEnabled !== undefined) setRoundingEnabled(Boolean(d.roundingEnabled));
      if (d.cashRoundingMode !== undefined) setCashRoundingMode(d.cashRoundingMode);
      if (d.maxCashDrawerAlert !== undefined) setMaxCashDrawerAlert(d.maxCashDrawerAlert);
      if (d.requireCashCountOnShiftClose !== undefined) setRequireCashCountOnShiftClose(d.requireCashCountOnShiftClose);
      if (d.printerInterface !== undefined) setPrinterInterface(d.printerInterface);
      if (d.printerPaperSize !== undefined) setPrinterPaperSize(d.printerPaperSize);
      if (d.networkPrinterIp !== undefined) setNetworkPrinterIp(d.networkPrinterIp);
      if (d.networkPrinterPort !== undefined) setNetworkPrinterPort(d.networkPrinterPort);
      if (d.autoCutPaper !== undefined) setAutoCutPaper(d.autoCutPaper);
      if (d.printCopies !== undefined) setPrintCopies(d.printCopies);
      if (d.printStoreLogo !== undefined) setPrintStoreLogo(d.printStoreLogo);
      if (d.printTaxDetail !== undefined) setPrintTaxDetail(d.printTaxDetail);
      if (d.printCustomerPoints !== undefined) setPrintCustomerPoints(d.printCustomerPoints);
      if (d.printReceiptBarcode !== undefined) setPrintReceiptBarcode(d.printReceiptBarcode);
      if (d.defaultCurrency !== undefined) setDefaultCurrency(d.defaultCurrency);
      if (d.systemTimezone !== undefined) setSystemTimezone(d.systemTimezone);
      if (d.taxEnabled !== undefined) setTaxEnabled(Boolean(d.taxEnabled));
      if (d.defaultTaxRate !== undefined) setDefaultTaxRate(Number(d.defaultTaxRate));
      if (d.serviceChargeRate !== undefined) setServiceChargeRate(d.serviceChargeRate);
      if (d.skuPrefixFormat !== undefined) setSkuPrefixFormat(d.skuPrefixFormat);
      if (d.lowStockDefaultAlert !== undefined) setLowStockDefaultAlert(d.lowStockDefaultAlert);
      if (d.requireSupervisorPinForVoid !== undefined) setRequireSupervisorPinForVoid(d.requireSupervisorPinForVoid);
      if (d.requirePinForDrawerKick !== undefined) setRequirePinForDrawerKick(d.requirePinForDrawerKick);
      if (d.requirePinForReprintOld !== undefined) setRequirePinForReprintOld(d.requirePinForReprintOld);
    };

    let storeDocData: any = null;
    let globalDocData: any = null;

    const syncBoth = () => {
      const sTime = storeDocData?.updatedAt ? new Date(storeDocData.updatedAt).getTime() : 0;
      const gTime = globalDocData?.updatedAt ? new Date(globalDocData.updatedAt).getTime() : 0;
      const merged =
        gTime > sTime
          ? { ...(storeDocData || {}), ...(globalDocData || {}) }
          : { ...(globalDocData || {}), ...(storeDocData || {}) };
      if (Object.keys(merged).length > 0) {
        applyDocData(merged);
      }
    };

    const unsubStore = onSnapshot(doc(db, 'stores', 'store_001', 'settings', 'pos'), (snap) => {
      if (snap.exists()) {
        storeDocData = snap.data();
        syncBoth();
      }
    });

    const unsubGlobal = onSnapshot(doc(db, 'settings', 'pos'), (snap) => {
      if (snap.exists()) {
        globalDocData = snap.data();
        syncBoth();
      }
    });

    return () => {
      unsubStore();
      unsubGlobal();
    };
  }, []);

  const persistPosSettingsPatch = async (patch: Record<string, any>) => {
    const payload = {
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    try {
      await Promise.all([
        setDoc(doc(db, 'stores', 'store_001', 'settings', 'pos'), payload, { merge: true }),
        setDoc(doc(db, 'settings', 'pos'), payload, { merge: true }),
      ]);
    } catch (err) {
      console.warn('Error syncing POS settings patch to Firestore:', err);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      selectedOutlet,
      storeName,
      storeAddress,
      storePhone,
      storeTaxNumber,
      storeFooterNote,
      autoLockMinutes,
      barcodeEnterSubmits,
      soundBeepEnabled,
      allowManualCashierDiscount,
      maxCashierDiscountPct,
      autoOpenCashDrawerOnCash,
      acceptCash,
      acceptQris,
      acceptEdc,
      acceptKasbon,
      acceptCod,
      roundingEnabled,
      cashRoundingMode,
      maxCashDrawerAlert,
      requireCashCountOnShiftClose,
      printerInterface,
      printerPaperSize,
      networkPrinterIp,
      networkPrinterPort,
      autoCutPaper,
      printCopies,
      printStoreLogo,
      printTaxDetail,
      printCustomerPoints,
      printReceiptBarcode,
      defaultCurrency,
      systemTimezone,
      taxEnabled,
      defaultTaxRate,
      serviceChargeRate,
      skuPrefixFormat,
      lowStockDefaultAlert,
      requireSupervisorPinForVoid,
      requirePinForDrawerKick,
      requirePinForReprintOld,
      updatedAt: new Date().toISOString(),
    };
    try {
      await Promise.all([
        setDoc(doc(db, 'stores', 'store_001', 'settings', 'pos'), payload, { merge: true }),
        setDoc(doc(db, 'settings', 'pos'), payload, { merge: true }),
      ]);
      if (activeSub === 'hak_akses') {
        for (const [role, pin] of [['supervisor', supervisorPin], ['manager', managerPin]] as const) {
          if (!pin) continue;
          const r = await fetch('/api/settings/pin', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${getServerToken() || (await auth?.currentUser?.getIdToken().catch(() => '')) || ''}`,
            },
            body: JSON.stringify({ storeId: 'store_001', role, pin }),
          });
          if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Gagal simpan PIN');
        }
        setSupervisorPin('');
        setManagerPin('');
      }
      await logAudit({
        action: 'UPDATE_POS_SETTINGS',
        target: `Konfigurasi ${activeSub.toUpperCase()} disimpan`,
      });
      // Global Setup: mata uang default langsung diterapkan ke seluruh aplikasi
      if (activeSub === 'global_setup') setCurrencyMode(defaultCurrency);
    } catch (err: any) {
      console.warn('Error saving POS settings to Firestore:', err);
      setSaveError(err?.message || String(err));
      setTimeout(() => setSaveError(null), 5000);
      return;
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  // ================= BACKUP: export koleksi Firestore nyata + metadata ke backup_snapshots =================
  const BACKUP_COLLECTIONS = [
    'products', 'product_batches', 'customers', 'suppliers', 'transactions', 'orders', 'procurements',
    'product_logs', 'stock_movements', 'shifts', 'cash_flows', 'pos_incomes', 'pos_expenses',
    'brangkas_modal', 'brangkas_untung', 'audit_logs', 'settlement_history', 'outlets', 'users',
  ];
  const [backupBusy, setBackupBusy] = useState<string | null>(null);

  const sha256Hex = async (text: string) => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  const handleExportBackup = async () => {
    setBackupBusy('Mengambil data dari Firestore…');
    try {
      const collections: Record<string, any[]> = {};
      const counts: Record<string, number> = {};
      for (const name of BACKUP_COLLECTIONS) {
        const snap = await getDocs(collection(db, name)).catch(() => null);
        collections[name] = snap ? snap.docs.map((d) => ({ __id: d.id, ...d.data() })) : [];
        counts[name] = collections[name].length;
      }
      const settingsSnap = await getDocs(collection(db, 'settings')).catch(() => null);
      collections.settings = settingsSnap
        ? settingsSnap.docs.filter((d) => d.id !== 'payment_gateway').map((d) => ({ __id: d.id, ...d.data() }))
        : [];
      const body = JSON.stringify({ app: 'RiskCart POS', version: 2, createdAt: new Date().toISOString(), outlet: selectedOutlet, collections });
      const checksum = await sha256Hex(body);
      const blob = new Blob([JSON.stringify({ checksum, payload: JSON.parse(body) })], { type: 'application/json' });
      const id = `BKP-${Date.now()}`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `riskcart-backup-${selectedOutlet}-${id}.json`;
      a.click();
      const totalDocs = Object.values(counts).reduce((x, y) => x + y, 0);
      await setDoc(doc(db, 'backup_snapshots', id), {
        id,
        timestamp: new Date().toLocaleString('id-ID'),
        createdAt: new Date().toISOString(),
        size: `${(blob.size / 1024).toFixed(1)} KB · ${totalDocs} dokumen`,
        checksum,
        counts,
        creator: auth?.currentUser?.email || 'unknown',
        storeId: 'store_001',
      });
      await logAudit({ action: 'BACKUP_EXPORT', target: `${id} (${totalDocs} dokumen)` });
      setBackupBusy(`Backup ${id} selesai: ${totalDocs} dokumen.`);
    } catch (e: any) {
      setBackupBusy(`Gagal backup: ${e?.message || e}`);
    }
  };

  const handleRestoreBackup = async (file: File) => {
    if (!window.confirm('Restore akan MENIMPA dokumen dengan ID yang sama. Lanjutkan?')) return;
    setBackupBusy('Memvalidasi file backup…');
    try {
      const parsed = JSON.parse(await file.text());
      const body = JSON.stringify(parsed.payload);
      if (!parsed.checksum || (await sha256Hex(body)) !== parsed.checksum) throw new Error('Checksum tidak cocok — file rusak / dimodifikasi.');
      let written = 0;
      for (const [name, docs] of Object.entries<any[]>(parsed.payload.collections || {})) {
        for (let i = 0; i < docs.length; i += 400) {
          const batch = writeBatch(db);
          docs.slice(i, i + 400).forEach(({ __id, ...data }) => batch.set(doc(db, name, String(__id)), data));
          await batch.commit();
          written += Math.min(400, docs.length - i);
          setBackupBusy(`Restore ${name}… (${written} dokumen)`);
        }
      }
      await logAudit({ action: 'BACKUP_RESTORE', target: `${file.name} (${written} dokumen)` });
      setBackupBusy(`Restore selesai: ${written} dokumen dipulihkan.`);
    } catch (e: any) {
      setBackupBusy(`Gagal restore: ${e?.message || e}`);
    }
  };

  // Audit log diurutkan terbaru (dukung data lama tanpa createdAt)
  const sortedAuditLogs = [...auditLogs].sort((a: any, b: any) => {
    const t = (x: any) => new Date(x.createdAt || x.timestamp || 0).getTime() || 0;
    return t(b) - t(a);
  });

  // Daftar outlet dari Firestore `outlets` (bukan hardcode)
  const { data: outletDocs } = useFirestoreList<any>('outlets', []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <Settings className="w-6 h-6 text-zinc-300" />
            <h1 className="text-2xl font-black text-white tracking-tight">
              PENGATURAN MESIN KASIR POS
            </h1>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            5.21 &mdash; Konfigurasi menyeluruh terminal kasir: hardware printer, payment gateway, brankas toko, backup snapshot, hak otorisasi supervisor, dan audit log.
          </p>
        </div>

        {/* Outlet Switcher */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400 font-semibold">Scope Outlet:</span>
          <select
            value={selectedOutlet}
            onChange={(e) => setSelectedOutlet(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-1.5 text-xs text-white font-bold"
          >
            {(outletDocs.length ? outletDocs : [{ id: selectedOutlet, name: selectedOutlet }]).map((o: any) => (
              <option key={o.id} value={o.code || o.id}>
                {(o.code || o.id) + (o.name && o.name !== (o.code || o.id) ? ` (${o.name})` : '')}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="flex items-center gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto w-fit max-w-full mb-4">
        <button
          onClick={() => setActiveSub('menu')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
            activeSub === 'menu'
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
          }`}
        >
          <FolderTree className="w-3.5 h-3.5 text-blue-400" />
          <span>Menu Builder (Drag &amp; Drop)</span>
          <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 font-mono font-bold border border-blue-500/30">
            WP-Style
          </span>
        </button>
        <button
          onClick={() => setActiveSub('umum')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            activeSub === 'umum' ? 'bg-zinc-700 text-white shadow' : 'text-zinc-400 hover:text-white'
          }`}
        >
          Umum
        </button>
        <button
          onClick={() => setActiveSub('toko')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'toko' ? 'bg-zinc-700 text-white shadow' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Store className="w-3.5 h-3.5" />
          <span>Toko</span>
        </button>
        <button
          onClick={() => setActiveSub('pembayaran')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'pembayaran' ? 'bg-zinc-700 text-white shadow' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <CreditCard className="w-3.5 h-3.5" />
          <span>Pembayaran</span>
        </button>
        <button
          onClick={() => setActiveSub('printer_struk')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'printer_struk' ? 'bg-zinc-700 text-white shadow' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Printer className="w-3.5 h-3.5" />
          <span>Printer Struk</span>
        </button>
        <button
          onClick={() => setActiveSub('global_setup')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'global_setup' ? 'bg-zinc-700 text-white shadow' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Global Setup</span>
        </button>
        <button
          onClick={() => setActiveSub('hak_akses')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'hak_akses' ? 'bg-zinc-700 text-white shadow' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Lock className="w-3.5 h-3.5" />
          <span>Hak dan Akses</span>
        </button>
        <button
          onClick={() => setActiveSub('backup_restore')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'backup_restore' ? 'bg-zinc-700 text-white shadow' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>Backup &amp; Restore</span>
        </button>
        <button
          onClick={() => setActiveSub('payment_gateway')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'payment_gateway' ? 'bg-cyan-600 text-white shadow' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          <span>Payment Gateway</span>
        </button>
        <button
          onClick={() => setActiveSub('audit_log')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
            activeSub === 'audit_log' ? 'bg-zinc-700 text-white shadow' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>Audit Log</span>
        </button>
      </div>

      {/* Governed Architecture Policy Banner */}
      <div className="p-3.5 rounded-xl bg-zinc-900 border border-zinc-800 flex items-start gap-3 text-xs text-zinc-300">
        <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-white">Governed Multi-Outlet POS Configuration Policy:</span>
          <p className="text-zinc-400 text-[11px] mt-0.5">
            Outlet aktif: {selectedOutlet}. Secret payment gateway disimpan terenkripsi di server (tidak pernah dikirim ke browser). PIN disimpan sebagai hash. Setiap perubahan tercatat di Audit Log.
          </p>
        </div>
      </div>

      {saveError && (
        <div className="p-4 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs font-semibold">
          Gagal menyimpan: {saveError}
        </div>
      )}

      {savedSuccess && (
        <div className="p-4 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-semibold">Konfigurasi POS berhasil diperbarui dan disinkronkan ke seluruh terminal kasir!</span>
        </div>
      )}

      {/* ============================================================== */}
      {/* 0. WORDPRESS-STYLE MENU BUILDER */}
      {/* ============================================================== */}
      {activeSub === 'menu' && <SidebarMenuBuilder />}

      {/* ============================================================== */}
      {/* 1. UMUM */}
      {/* ============================================================== */}
      {activeSub === 'umum' && (
        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
              <h3 className="font-bold text-white text-sm pb-2 border-b border-zinc-800">
                Perilaku Kasir &amp; Barcode Scanner
              </h3>
              <div className="space-y-3 text-xs">
                <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                  <div>
                    <div className="font-semibold text-white">Auto-Submit Barcode Scanner Enter Key</div>
                    <div className="text-[11px] text-zinc-400">Tekan enter otomatis menambah item saat scan barcode</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={barcodeEnterSubmits}
                    onChange={(e) => setBarcodeEnterSubmits(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-0"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                  <div>
                    <div className="font-semibold text-white">Efek Suara Beep Kasir</div>
                    <div className="text-[11px] text-zinc-400">Bunyi konfirmasi saat item berhasil dimasukkan keranjang</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={soundBeepEnabled}
                    onChange={(e) => setSoundBeepEnabled(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-0"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                  <div>
                    <div className="font-semibold text-white">Buka Laci Kasir Otomatis (Cash)</div>
                    <div className="text-[11px] text-zinc-400">Kirim pulsa RJ11 ke laci uang saat checkout tunai selesai</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoOpenCashDrawerOnCash}
                    onChange={(e) => setAutoOpenCashDrawerOnCash(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-0"
                  />
                </label>
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
              <h3 className="font-bold text-white text-sm pb-2 border-b border-zinc-800">
                Keamanan &amp; Kunci Terminal
              </h3>
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Auto-Lock Terminal Inaktivitas (Menit)</label>
                  <select
                    value={autoLockMinutes}
                    onChange={(e) => setAutoLockMinutes(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                  >
                    <option value={5}>5 Menit</option>
                    <option value={10}>10 Menit (Direkomendasikan)</option>
                    <option value={30}>30 Menit</option>
                    <option value={0}>Jangan Kunci Otomatis</option>
                  </select>
                </div>

                <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                  <div>
                    <div className="font-semibold text-white">Izinkan Diskon Kasir Manual</div>
                    <div className="text-[11px] text-zinc-400">Bolehkan kasir input diskon tanpa approval supervisor</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={allowManualCashierDiscount}
                    onChange={(e) => setAllowManualCashierDiscount(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-0"
                  />
                </label>

                {allowManualCashierDiscount && (
                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Maksimal Diskon Kasir Tanpa PIN (%)</label>
                    <input
                      type="number"
                      value={maxCashierDiscountPct}
                      onChange={(e) => setMaxCashierDiscountPct(Number(e.target.value))}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-bold"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-zinc-800">
            <button
              type="submit"
              className="px-6 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-white font-bold rounded-xl text-xs flex items-center gap-2 cursor-pointer shadow"
            >
              <Save className="w-4 h-4" />
              <span>Simpan Pengaturan Umum POS</span>
            </button>
          </div>
        </form>
      )}

      {/* ============================================================== */}
      {/* 2. TOKO */}
      {/* ============================================================== */}
      {activeSub === 'toko' && (
        <form onSubmit={handleSave} className="space-y-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-white text-sm pb-2 border-b border-zinc-800 flex items-center gap-2">
              <Store className="w-4 h-4 text-emerald-400" />
              <span>Identitas Outlet ({selectedOutlet})</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Nama Outlet / Cabang Toko</label>
                <input
                  type="text"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Nomor NPWP Toko</label>
                <input
                  type="text"
                  value={storeTaxNumber}
                  onChange={(e) => setStoreTaxNumber(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Telepon Kasir / WhatsApp</label>
                <input
                  type="text"
                  value={storePhone}
                  onChange={(e) => setStorePhone(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Alamat Outlet</label>
                <input
                  type="text"
                  value={storeAddress}
                  onChange={(e) => setStoreAddress(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-zinc-400 font-semibold mb-1">Catatan Kaki Struk Kasir (Footer Note)</label>
                <textarea
                  rows={2}
                  value={storeFooterNote}
                  onChange={(e) => setStoreFooterNote(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
            </div>
          </div>

          {/* Pengaturan PPN & Pembulatan Kasir langsung di Tab Toko */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Pajak PPN Toko */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                <div>
                  <h3 className="font-bold text-white text-sm">Pajak PPN Toko</h3>
                  <p className="text-[11px] text-zinc-400">Aktifkan atau nonaktifkan perhitungan PPN pada mesin kasir POS</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !taxEnabled;
                    setTaxEnabled(next);
                    persistPosSettingsPatch({ taxEnabled: next, defaultTaxRate });
                  }}
                  className={`relative inline-flex h-6 w-12 items-center rounded-full transition-colors cursor-pointer ${
                    taxEnabled ? 'bg-emerald-600' : 'bg-zinc-700'
                  }`}
                  aria-label="Toggle PPN Toko"
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      taxEnabled ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <span className="text-zinc-300 font-semibold">Status Pajak PPN</span>
                  <span
                    className={`px-2.5 py-0.5 rounded-md font-bold text-[11px] ${
                      taxEnabled
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                    }`}
                  >
                    {taxEnabled ? `ON (${defaultTaxRate}%)` : 'OFF (Tanpa PPN)'}
                  </span>
                </div>

                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Besaran Tarif PPN (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    disabled={!taxEnabled}
                    value={defaultTaxRate}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setDefaultTaxRate(val);
                    }}
                    className={`w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-bold ${
                      !taxEnabled ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  />
                </div>
              </div>
            </div>

            {/* Pembulatan Harga / Tagihan Kasir Toko */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                <div>
                  <h3 className="font-bold text-white text-sm">Pembulatan Harga Kasir</h3>
                  <p className="text-[11px] text-zinc-400">Aktifkan atau matikan pembulatan otomatis total tagihan POS</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !roundingEnabled;
                    const nextMode = next && cashRoundingMode === 'none' ? 'floor_100' : cashRoundingMode;
                    setRoundingEnabled(next);
                    if (next && cashRoundingMode === 'none') setCashRoundingMode('floor_100');
                    persistPosSettingsPatch({ roundingEnabled: next, cashRoundingMode: nextMode });
                  }}
                  className={`relative inline-flex h-6 w-12 items-center rounded-full transition-colors cursor-pointer ${
                    roundingEnabled && cashRoundingMode !== 'none' ? 'bg-emerald-600' : 'bg-zinc-700'
                  }`}
                  aria-label="Toggle Pembulatan Kasir"
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      roundingEnabled && cashRoundingMode !== 'none' ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <span className="text-zinc-300 font-semibold">Status Pembulatan</span>
                  <span
                    className={`px-2.5 py-0.5 rounded-md font-bold text-[11px] ${
                      roundingEnabled && cashRoundingMode !== 'none'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                    }`}
                  >
                    {roundingEnabled && cashRoundingMode !== 'none'
                      ? cashRoundingMode === 'floor_100'
                        ? 'ON (Bulat Bawah 100)'
                        : 'ON (Bulat Atas 500)'
                      : 'OFF (Nominal Asli)'}
                  </span>
                </div>

                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Metode Pembulatan Tagihan</label>
                  <select
                    disabled={!roundingEnabled}
                    value={roundingEnabled ? cashRoundingMode : 'none'}
                    onChange={(e) => {
                      const mode = e.target.value as 'none' | 'floor_100' | 'ceil_500';
                      setCashRoundingMode(mode);
                      const nextEnabled = mode !== 'none';
                      setRoundingEnabled(nextEnabled);
                      persistPosSettingsPatch({ cashRoundingMode: mode, roundingEnabled: nextEnabled });
                    }}
                    className={`w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white ${
                      !roundingEnabled ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    <option value="floor_100">Bulatkan ke Bawah Kelipatan 100 (IDR 100 / USD $0.10)</option>
                    <option value="ceil_500">Bulatkan ke Atas Kelipatan 500 (IDR 500 / USD $0.50)</option>
                    <option value="none">Tanpa Pembulatan (Nominal Asli)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-zinc-800">
            <button
              type="submit"
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-2 cursor-pointer shadow"
            >
              <Save className="w-4 h-4" />
              <span>Simpan Profil &amp; Pengaturan Toko</span>
            </button>
          </div>
        </form>
      )}

      {/* ============================================================== */}
      {/* 3. PEMBAYARAN */}
      {/* ============================================================== */}
      {activeSub === 'pembayaran' && (
        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
              <h3 className="font-bold text-white text-sm pb-2 border-b border-zinc-800">
                Metode Pembayaran Kasir yang Diizinkan
              </h3>
              <div className="space-y-3 text-xs">
                <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                  <span className="font-semibold text-white">Uang Tunai (Cash)</span>
                  <input
                    type="checkbox"
                    checked={acceptCash}
                    onChange={(e) => setAcceptCash(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-0"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                  <span className="font-semibold text-white">QRIS Dinamis &amp; Statis</span>
                  <input
                    type="checkbox"
                    checked={acceptQris}
                    onChange={(e) => setAcceptQris(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-0"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                  <span className="font-semibold text-white">EDC Debit &amp; Kartu Kredit</span>
                  <input
                    type="checkbox"
                    checked={acceptEdc}
                    onChange={(e) => setAcceptEdc(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-0"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                  <span className="font-semibold text-white">Kasbon Pelanggan Terdaftar</span>
                  <input
                    type="checkbox"
                    checked={acceptKasbon}
                    onChange={(e) => setAcceptKasbon(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-0"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                  <span className="font-semibold text-white">COD Pembayaran di Tempat</span>
                  <input
                    type="checkbox"
                    checked={acceptCod}
                    onChange={(e) => setAcceptCod(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-0"
                  />
                </label>
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
              <h3 className="font-bold text-white text-sm pb-2 border-b border-zinc-800">
                Aturan Settlement &amp; Brankas Kasir
              </h3>
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div>
                    <div className="font-semibold text-white">Aktifkan Pembulatan Tagihan Kasir (On/Off)</div>
                    <div className="text-[11px] text-zinc-400">Otomatis bulatkan total belanja di IDR maupun USD</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !roundingEnabled;
                      const nextMode = next && cashRoundingMode === 'none' ? 'floor_100' : cashRoundingMode;
                      setRoundingEnabled(next);
                      if (next && cashRoundingMode === 'none') setCashRoundingMode('floor_100');
                      persistPosSettingsPatch({ roundingEnabled: next, cashRoundingMode: nextMode });
                    }}
                    className={`relative inline-flex h-6 w-12 items-center rounded-full transition-colors cursor-pointer ${
                      roundingEnabled && cashRoundingMode !== 'none' ? 'bg-emerald-600' : 'bg-zinc-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        roundingEnabled && cashRoundingMode !== 'none' ? 'translate-x-7' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Toleransi Pembulatan Uang Kembalian</label>
                  <select
                    disabled={!roundingEnabled}
                    value={roundingEnabled ? cashRoundingMode : 'none'}
                    onChange={(e) => {
                      const mode = e.target.value as 'none' | 'floor_100' | 'ceil_500';
                      setCashRoundingMode(mode);
                      const nextEnabled = mode !== 'none';
                      setRoundingEnabled(nextEnabled);
                      persistPosSettingsPatch({ cashRoundingMode: mode, roundingEnabled: nextEnabled });
                    }}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                  >
                    <option value="none">Tanpa Pembulatan (Nominal Asli)</option>
                    <option value="floor_100">Bulatkan ke Bawah Kelipatan 100 (IDR 100 / USD $0.10)</option>
                    <option value="ceil_500">Bulatkan ke Atas Kelipatan 500 (IDR 500 / USD $0.50)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Peringatan Maksimal Kas di Laci (Rp)</label>
                  <input
                    type="number"
                    value={maxCashDrawerAlert}
                    onChange={(e) => setMaxCashDrawerAlert(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-bold"
                  />
                  <span className="text-[10px] text-zinc-500">Peringatan setor ke brankas jika uang di kasir menumpuk</span>
                </div>

                <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                  <div>
                    <div className="font-semibold text-white">Wajib Hitung Uang Fisik Saat Tutup Shift</div>
                    <div className="text-[11px] text-zinc-400">Kasir harus input rincian lembaran uang sebelum cetak Z-Report</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={requireCashCountOnShiftClose}
                    onChange={(e) => setRequireCashCountOnShiftClose(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-0"
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-zinc-800">
            <button
              type="submit"
              className="px-6 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-white font-bold rounded-xl text-xs flex items-center gap-2 cursor-pointer shadow"
            >
              <Save className="w-4 h-4" />
              <span>Simpan Konfigurasi Pembayaran</span>
            </button>
          </div>
        </form>
      )}

      {/* ============================================================== */}
      {/* 4. PRINTER STRUK */}
      {/* ============================================================== */}
      {activeSub === 'printer_struk' && (
        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
                <h3 className="font-bold text-white text-sm pb-2 border-b border-zinc-800 flex items-center gap-2">
                  <Printer className="w-4 h-4 text-cyan-400" />
                  <span>Koneksi Printer Thermal ESC/POS</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Tipe Koneksi Printer</label>
                    <select
                      value={printerInterface}
                      onChange={(e) => setPrinterInterface(e.target.value as any)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                    >
                      <option value="usb">USB Direct ESC/POS Driver</option>
                      <option value="bluetooth">Bluetooth Thermal Printer (Portable)</option>
                      <option value="network">LAN / Ethernet IP Printer</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Ukuran Kertas Struk</label>
                    <select
                      value={printerPaperSize}
                      onChange={(e) => setPrinterPaperSize(e.target.value as any)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-bold"
                    >
                      <option value="80mm">80mm (Lebar Standar Kasir - 48 Karakter)</option>
                      <option value="58mm">58mm (Kecil Portable - 32 Karakter)</option>
                    </select>
                  </div>

                  {printerInterface === 'network' && (
                    <>
                      <div>
                        <label className="block text-zinc-400 font-semibold mb-1">IP Address Printer</label>
                        <input
                          type="text"
                          value={networkPrinterIp}
                          onChange={(e) => setNetworkPrinterIp(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-zinc-400 font-semibold mb-1">Port</label>
                        <input
                          type="text"
                          value={networkPrinterPort}
                          onChange={(e) => setNetworkPrinterPort(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
                <h3 className="font-bold text-white text-sm pb-2 border-b border-zinc-800">
                  Perilaku Cetak Struk
                </h3>
                <div className="space-y-3 text-xs">
                  <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                    <div>
                      <div className="font-semibold text-white">Auto-Cut Kertas (Pisau Pemotong)</div>
                      <div className="text-[11px] text-zinc-400">Potong kertas otomatis setelah struk selesai cetak</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={autoCutPaper}
                      onChange={(e) => setAutoCutPaper(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-0"
                    />
                  </label>

                  <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                    <div>
                      <div className="font-semibold text-white">Tampilkan Logo Toko di Header Struk</div>
                      <div className="text-[11px] text-zinc-400">Cetak logo monokrom hitam putih resolusi 384x120px</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={printStoreLogo}
                      onChange={(e) => setPrintStoreLogo(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-0"
                    />
                  </label>

                  <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                    <div>
                      <div className="font-semibold text-white">Cetak QR Code Validasi di Bawah Struk</div>
                      <div className="text-[11px] text-zinc-400">QR Code untuk cek keaslian struk dan klaim komplain</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={printReceiptBarcode}
                      onChange={(e) => setPrintReceiptBarcode(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-0"
                    />
                  </label>

                  <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                    <div className="font-semibold text-white">Tampilkan Rincian PPN di Struk</div>
                    <input type="checkbox" checked={printTaxDetail} onChange={(e) => setPrintTaxDetail(e.target.checked)} className="w-4 h-4" />
                  </label>
                  <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                    <div className="font-semibold text-white">Tampilkan Poin Pelanggan di Struk</div>
                    <input type="checkbox" checked={printCustomerPoints} onChange={(e) => setPrintCustomerPoints(e.target.checked)} className="w-4 h-4" />
                  </label>
                  <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                    <div className="font-semibold text-white">Jumlah Salinan Struk</div>
                    <select
                      value={printCopies}
                      onChange={(e) => setPrintCopies(Number(e.target.value) as 1 | 2)}
                      className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-white"
                    >
                      <option value={1}>1 lembar</option>
                      <option value={2}>2 lembar</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Preview struk dari transaksi terakhir (data asli) + Test Print */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
              <h4 className="font-bold text-white text-xs flex items-center justify-between">
                <span>Preview Struk ({printerPaperSize}) — transaksi terakhir</span>
                <span className="text-[10px] text-emerald-400">{printerInterface.toUpperCase()}</span>
              </h4>
              {(() => {
                const liveSettings = {
                  storeName, storeAddress, storePhone, storeTaxNumber, storeFooterNote,
                  printerInterface, printerPaperSize, networkPrinterIp, networkPrinterPort, autoCutPaper,
                  printCopies, printStoreLogo, printTaxDetail, printCustomerPoints, printReceiptBarcode,
                };
                if (!lastTx) return <div className="text-[11px] text-zinc-500">Belum ada transaksi untuk dipreview.</div>;
                const lines = receiptLines(
                  { ...lastTx, cashPaid: lastTx.cashPaid ?? lastTx.paidAmount, change: lastTx.change ?? 0 },
                  liveSettings,
                  printerPaperSize === '58mm' ? 32 : 48
                );
                return (
                  <>
                    <pre
                      className={`mx-auto bg-white text-zinc-900 p-3 font-mono leading-tight rounded border border-zinc-300 whitespace-pre-wrap ${
                        printerPaperSize === '58mm' ? 'max-w-[220px] text-[8px]' : 'max-w-[300px] text-[8px]'
                      }`}
                    >
                      {lines.join('\n')}
                    </pre>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await printReceipt({ ...lastTx, cashPaid: lastTx.cashPaid ?? lastTx.paidAmount, change: lastTx.change ?? 0 }, liveSettings);
                          void logAudit({ action: 'PRINTER_TEST', target: `Test print (${printerInterface}, ${printerPaperSize})` });
                        } catch (err: any) {
                          setSaveError(`Test print gagal: ${err?.message || err}`);
                        }
                      }}
                      className="w-full py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold"
                    >
                      Test Print
                    </button>
                  </>
                );
              })()}
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                USB/Bluetooth: cetak lewat printer yang terpasang di perangkat (auto-cut & laci mengikuti driver printer).
                LAN: dikirim ESC/POS langsung ke IP printer (auto-cut & buka laci didukung; server harus satu jaringan dengan printer).
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-zinc-800">
            <button
              type="submit"
              className="px-6 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl text-xs flex items-center gap-2 cursor-pointer shadow"
            >
              <Save className="w-4 h-4" />
              <span>Simpan Konfigurasi Printer</span>
            </button>
          </div>
        </form>
      )}

      {/* ============================================================== */}
      {/* 5. GLOBAL SETUP */}
      {/* ============================================================== */}
      {activeSub === 'global_setup' && (
        <form onSubmit={handleSave} className="space-y-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-white text-sm pb-2 border-b border-zinc-800 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-purple-400" />
              <span>Shared Business Defaults &amp; System Configuration</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Mata Uang Utama</label>
                <select
                  value={defaultCurrency}
                  onChange={(e) => setDefaultCurrency(e.target.value as any)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-bold"
                >
                  <option value="IDR">IDR (Rupiah Indonesia - Rp)</option>
                  <option value="USD">USD (US Dollar - $)</option>
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Zona Waktu Sistem</label>
                <select
                  value={systemTimezone}
                  onChange={(e) => setSystemTimezone(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono"
                >
                  <option value="Asia/Jakarta (WIB)">Asia/Jakarta (WIB - UTC+7)</option>
                  <option value="Asia/Makassar (WITA)">Asia/Makassar (WITA - UTC+8)</option>
                  <option value="Asia/Jayapura (WIT)">Asia/Jayapura (WIT - UTC+9)</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-zinc-400 font-semibold">Tarif Pajak PPN Default (%)</label>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !taxEnabled;
                      setTaxEnabled(next);
                      persistPosSettingsPatch({ taxEnabled: next, defaultTaxRate });
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition ${
                      taxEnabled
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                    }`}
                  >
                    {taxEnabled ? 'PPN: ON' : 'PPN: OFF'}
                  </button>
                </div>
                <input
                  type="number"
                  disabled={!taxEnabled}
                  value={defaultTaxRate}
                  onChange={(e) => setDefaultTaxRate(Number(e.target.value))}
                  className={`w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-bold ${
                    !taxEnabled ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Service Charge (%)</label>
                <input
                  type="number"
                  value={serviceChargeRate}
                  onChange={(e) => setServiceChargeRate(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-bold"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Format Auto-Generator SKU</label>
                <input
                  type="text"
                  value={skuPrefixFormat}
                  onChange={(e) => setSkuPrefixFormat(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Ambang Peringatan Stok Minimum Default (Pcs)</label>
                <input
                  type="number"
                  value={lowStockDefaultAlert}
                  onChange={(e) => setLowStockDefaultAlert(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-bold"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-zinc-800">
            <button
              type="submit"
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-xs flex items-center gap-2 cursor-pointer shadow"
            >
              <Save className="w-4 h-4" />
              <span>Simpan Global Setup</span>
            </button>
          </div>
        </form>
      )}

      {/* ============================================================== */}
      {/* 6. HAK DAN AKSES */}
      {/* ============================================================== */}
      {activeSub === 'hak_akses' && (
        <form onSubmit={handleSave} className="space-y-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-white text-sm pb-2 border-b border-zinc-800 flex items-center gap-2">
              <Lock className="w-4 h-4 text-rose-400" />
              <span>Role-Based Permissions &amp; Supervisor Protected Operations</span>
            </h3>

            <div className="space-y-3 text-xs">
              <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                <div>
                  <div className="font-semibold text-white">Wajibkan PIN Supervisor untuk Void / Batalkan Struk</div>
                  <div className="text-[11px] text-zinc-400">Mencegah kasir menghapus transaksi tanpa audit pengawas</div>
                </div>
                <input
                  type="checkbox"
                  checked={requireSupervisorPinForVoid}
                  onChange={(e) => setRequireSupervisorPinForVoid(e.target.checked)}
                  className="w-4 h-4 rounded text-rose-600 focus:ring-0"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                <div>
                  <div className="font-semibold text-white">Wajibkan PIN Supervisor untuk Buka Laci Kasir Manual (No-Sale)</div>
                  <div className="text-[11px] text-zinc-400">Laci kasir tidak dapat dibuka tanpa ada struk belanja kecuali diotorisasi</div>
                </div>
                <input
                  type="checkbox"
                  checked={requirePinForDrawerKick}
                  onChange={(e) => setRequirePinForDrawerKick(e.target.checked)}
                  className="w-4 h-4 rounded text-rose-600 focus:ring-0"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                <div>
                  <div className="font-semibold text-white">Wajibkan PIN untuk Cetak Ulang Struk Kemarin</div>
                  <div className="text-[11px] text-zinc-400">Reprint struk dari shift sebelumnya memerlukan otorisasi</div>
                </div>
                <input
                  type="checkbox"
                  checked={requirePinForReprintOld}
                  onChange={(e) => setRequirePinForReprintOld(e.target.checked)}
                  className="w-4 h-4 rounded text-rose-600 focus:ring-0"
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3">
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Master PIN Supervisor (4-Digit)</label>
                  <input
                    type="password"
                    maxLength={6}
                    value={supervisorPin}
                    placeholder="Isi untuk mengganti (4-8 digit)"
                    onChange={(e) => setSupervisorPin(e.target.value.replace(/\D/g, ''))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono tracking-widest text-center"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Master PIN Store Manager / Owner (6-Digit)</label>
                  <input
                    type="password"
                    maxLength={8}
                    value={managerPin}
                    placeholder="Isi untuk mengganti (4-8 digit)"
                    onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, ''))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono tracking-widest text-center"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-zinc-800">
            <button
              type="submit"
              className="px-6 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs flex items-center gap-2 cursor-pointer shadow"
            >
              <Save className="w-4 h-4" />
              <span>Simpan Aturan Proteksi PIN</span>
            </button>
          </div>
        </form>
      )}

      {/* ============================================================== */}
      {/* 7. BACKUP AND RESTORE */}
      {/* ============================================================== */}
      {activeSub === 'backup_restore' && (
        <div className="space-y-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800">
              <div>
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-400" />
                  <span>Authorized Backup Creation &amp; Safe Restore</span>
                </h3>
                <p className="text-zinc-400 text-xs mt-0.5">
                  Snapshot database Firestore dan konfigurasi lokal tersimpan dengan integritas checksum sha256.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportBackup}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition shadow"
                >
                  <Download className="w-4 h-4" />
                  <span>Buat &amp; Unduh Snapshot Sekarang</span>
                </button>
                <label className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer border border-zinc-700">
                  <Upload className="w-4 h-4" />
                  <span>Restore dari File</span>
                  <input
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleRestoreBackup(f);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
            {backupBusy && (
              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-300">{backupBusy}</div>
            )}

            {/* Snapshots Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400 text-[11px] uppercase tracking-wider">
                    <th className="py-2.5 px-3">Snapshot ID</th>
                    <th className="py-2.5 px-3">Waktu Pembuatan</th>
                    <th className="py-2.5 px-3">Ukuran</th>
                    <th className="py-2.5 px-3">Checksum SHA256</th>
                    <th className="py-2.5 px-3">Dibuat Oleh</th>
                    <th className="py-2.5 px-3 text-right">Isi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 font-mono">
                  {backupSnapshots.map((b) => (
                    <tr key={b.id} className="hover:bg-zinc-800/30">
                      <td className="py-3 px-3 font-bold text-white">{b.id}</td>
                      <td className="py-3 px-3 text-zinc-300 font-sans">{b.timestamp}</td>
                      <td className="py-3 px-3 text-emerald-400">{b.size}</td>
                      <td className="py-3 px-3 text-zinc-500 text-[10px]">{b.checksum}</td>
                      <td className="py-3 px-3 text-zinc-300 font-sans">{b.creator}</td>
                      <td className="py-3 px-3 text-right font-sans text-[10px] text-zinc-500">
                        {b.counts ? `${Object.keys(b.counts).length} koleksi` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* DANGER ZONE: RESET & HAPUS SELURUH DATABASE */}
          <div className="bg-zinc-900 border border-rose-900/60 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-rose-950">
              <div>
                <h3 className="font-bold text-rose-400 text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-500" />
                  <span>Zona Berbahaya: Reset Database Siap Input Ulang</span>
                </h3>
                <p className="text-zinc-400 text-xs mt-0.5">
                  Menghapus seluruh dokumen transaksi, produk, pesanan, inventaris, dan riwayat di semua koleksi Firestore untuk kembali ke kondisi awal bersih.
                </p>
              </div>

              <button
                onClick={() => setShowConfirmResetModal(true)}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition shadow-lg shadow-rose-600/30 shrink-0"
              >
                <Trash2 className="w-4 h-4" />
                <span>Reset &amp; Hapus Semua Data Database</span>
              </button>
            </div>

            {resetDbFeedback && (
              <div className="p-3 bg-emerald-950/80 border border-emerald-800 rounded-xl text-emerald-300 text-xs font-bold">
                {resetDbFeedback}
              </div>
            )}
          </div>

          {/* Modal Konfirmasi Reset Database */}
          {showConfirmResetModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
              <div className="bg-zinc-900 border border-rose-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
                <div className="flex items-center gap-2 text-rose-400 pb-2 border-b border-zinc-800">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <h3 className="font-bold text-white text-base">Konfirmasi Reset Database</h3>
                </div>

                <p className="text-xs text-zinc-300 leading-relaxed">
                  Apakah Anda yakin ingin menghapus <strong>seluruh data toko</strong> di Firebase Firestore?
                  Tindakan ini tidak dapat dibatalkan dan seluruh riwayat penjualan, produk, kas, dan akun akan dikosongkan.
                </p>

                <div className="flex gap-2 pt-2 border-t border-zinc-800">
                  <button
                    disabled={isResettingDb}
                    onClick={async () => {
                      setIsResettingDb(true);
                      try {
                        const res = await resetAllDatabaseData();
                        setResetDbFeedback(`Database berhasil di-reset (${res.deletedCount} dokumen terhapus).`);
                        setShowConfirmResetModal(false);
                        setTimeout(() => {
                          window.location.reload();
                        }, 1800);
                      } catch (err: any) {
                        setResetDbFeedback(`Gagal: ${err.message || err}`);
                      } finally {
                        setIsResettingDb(false);
                      }
                    }}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>{isResettingDb ? 'Mereset...' : 'Ya, Hapus Semua'}</span>
                  </button>
                  <button
                    disabled={isResettingDb}
                    onClick={() => setShowConfirmResetModal(false)}
                    className="py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition cursor-pointer"
                  >
                    Batal
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* 8. PAYMENT GATEWAY — REAL (server /api/payments/*, secret terenkripsi) */}
      {/* ============================================================== */}
      {activeSub === 'payment_gateway' && <PaymentGatewaySettings />}

      {/* ============================================================== */}
      {/* 9. AUDIT LOG */}
      {/* ============================================================== */}
      {activeSub === 'audit_log' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <div>
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <History className="w-4 h-4 text-zinc-400" />
                <span>Audit Trail Perubahan Konfigurasi &amp; Aksi Kasir</span>
              </h3>
              <p className="text-zinc-400 text-xs mt-0.5">
                Log kronologis setiap aktivitas yang mengubah brankas, setting printer, kredensial, dan otorisasi supervisor.
              </p>
            </div>
            <button
              onClick={() => {
                setLogRefreshed(true);
                setTimeout(() => setLogRefreshed(false), 2500);
              }}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold border border-zinc-700 cursor-pointer flex items-center gap-1.5"
            >
              <span className="text-emerald-400">Realtime Firestore &bull; {auditLogs.length} log</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400 text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-3">Log ID</th>
                  <th className="py-2.5 px-3">Timestamp</th>
                  <th className="py-2.5 px-3">Petugas</th>
                  <th className="py-2.5 px-3">Aksi</th>
                  <th className="py-2.5 px-3">Rincian Perubahan</th>
                  <th className="py-2.5 px-3 text-right">Terminal IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-mono text-[11px]">
                {sortedAuditLogs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-zinc-800/30">
                    <td className="py-3 px-3 font-bold text-white">{log.id}</td>
                    <td className="py-3 px-3 text-zinc-300 font-sans">{log.createdAt ? new Date(log.createdAt).toLocaleString('id-ID') : log.timestamp}</td>
                    <td className="py-3 px-3 text-blue-400 font-sans font-semibold">
                      {log.user || log.staffName || '-'}
                      {log.verified && <span className="ml-1 text-[9px] text-emerald-400">✓ terverifikasi</span>}
                      {(log.user === 'Owner Admin' || log.ip === 'Admin Session') && (
                        <span className="ml-1 text-[9px] text-zinc-500">(data lama)</span>
                      )}
                    </td>
                    <td className="py-3 px-3 font-bold text-emerald-400">{log.action || log.type}</td>
                    <td className="py-3 px-3 text-zinc-300 font-sans">{log.target}</td>
                    <td className="py-3 px-3 text-right text-zinc-500" title={log.userAgent || ''}>{log.ip || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
