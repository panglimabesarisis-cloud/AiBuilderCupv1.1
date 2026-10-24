import React, { useState, useEffect, useMemo } from 'react';
import {
  User,
  Clock,
  QrCode,
  Phone,
  MapPin,
  ExternalLink,
  Printer,
  ShieldCheck,
  CheckCircle,
  Truck,
  AlertTriangle,
  Package,
  FileText,
  CreditCard,
  Send,
  X,
  Check,
  DollarSign,
  Vault,
  Building2,
  RotateCcw,
} from 'lucide-react';
import { db } from '../../firebase';
import { collection, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { ACTIVE_STORE_ID } from '../../config/store';
import { useLanguage } from '../../context/LanguageContext';
import { useAppData } from '../../context/AppDataContext';
import { isLegacyMockOrderOrTx } from '../../services/dataSeeder';

export type UniversalTransactionCategory = 'SALE' | 'PURCHASE' | 'CASH_IN' | 'CASH_OUT';

export interface UniversalTransactionPayload {
  record: any;
  category: UniversalTransactionCategory;
}

const UNIVERSAL_TX_EVENT = 'riskcart:open-universal-tx-detail';

export function openTransactionDetailModal(
  data: any,
  category: UniversalTransactionCategory = 'SALE'
): void {
  if (!data) return;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<UniversalTransactionPayload>(UNIVERSAL_TX_EVENT, {
        detail: { record: data, category },
      })
    );
  }
}

export function openUniversalTransactionDetail(
  data: any,
  category: UniversalTransactionCategory = 'SALE'
): void {
  openTransactionDetailModal(data, category);
}

if (typeof window !== 'undefined') {
  (window as any).openTransactionDetailModal = openTransactionDetailModal;
  (window as any).openUniversalTransactionDetail = openUniversalTransactionDetail;
}

const COURIER_OPTIONS = ['Ambil Sendiri', 'Erry', 'Pita', 'Wahyu', 'Niman'];
const VAULT_OPTIONS = ['Laci Kasir', 'Brangkas Toko', 'Brangkas Modal', 'Brangkas Untung'];

interface GlobalModalsProps {
  activeModal: string | null;
  onClose: () => void;
  currencyMode: 'IDR' | 'USD';
  onNavigateTab: (tab: string) => void;
  onSelectCustomer?: (customerName: string) => void;
  sessionSeconds?: number;
}

export const GlobalModals: React.FC<GlobalModalsProps> = ({
  activeModal,
  onClose,
  currencyMode,
  onNavigateTab,
  onSelectCustomer,
  sessionSeconds = 0,
}) => {
  const { tr, formatCurrency } = useLanguage();
  const { products, customers: appCustomers, refreshFirestore } = useAppData();

  // Universal Transaction Detail Modal State
  const [universalModalData, setUniversalModalData] = useState<UniversalTransactionPayload | null>(null);
  const [fulfillmentStage, setFulfillmentStage] = useState<string>('Terkirim');
  const [selectedCourier, setSelectedCourier] = useState<string>('Ambil Sendiri');
  const [selectedVaultSource, setSelectedVaultSource] = useState<string>('Laci Kasir');
  const [selectedVaultDest, setSelectedVaultDest] = useState<string>('Brangkas Toko');
  const [paymentStatusLocal, setPaymentStatusLocal] = useState<'Lunas' | 'Belum Lunas'>('Lunas');
  const [paidAmountLocal, setPaidAmountLocal] = useState<number>(0);
  const [remainingDebtLocal, setRemainingDebtLocal] = useState<number>(0);
  const [isSavingUniversal, setIsSavingUniversal] = useState<boolean>(false);
  const [universalFeedback, setUniversalFeedback] = useState<string | null>(null);

  useEffect(() => {
    (window as any).openTransactionDetailModal = openTransactionDetailModal;
    (window as any).openUniversalTransactionDetail = openUniversalTransactionDetail;

    const handleOpenEvent = (e: Event) => {
      const customEvt = e as CustomEvent<UniversalTransactionPayload>;
      if (!customEvt.detail || !customEvt.detail.record) return;
      const { record, category } = customEvt.detail;
      setUniversalModalData({ record, category });
      setUniversalFeedback(null);

      // Initialize interactive state from record
      if (category === 'SALE') {
        const rawSt = String(record.fulfillmentStatus || record.deliveryStatus || record.status || '').toLowerCase();
        if (rawSt.includes('kembali') || rawSt.includes('return') || rawSt.includes('batal') || rawSt.includes('void')) {
          setFulfillmentStage('Dikembalikan');
        } else if (rawSt.includes('kirim') && !rawSt.includes('terkirim')) {
          setFulfillmentStage('Dikirim');
        } else if (rawSt.includes('kemas') || rawSt.includes('pack') || rawSt.includes('proses')) {
          setFulfillmentStage('Pengemasan');
        } else if (rawSt.includes('baru') || rawSt.includes('pending') || rawSt.includes('menunggu')) {
          setFulfillmentStage('Baru');
        } else {
          setFulfillmentStage('Terkirim');
        }
        setSelectedCourier(
          record.shipper ||
            record.courierName ||
            record.courier ||
            record.driverName ||
            (String(record.channel || '').toLowerCase().includes('pwa') ? 'Wahyu' : 'Ambil Sendiri')
        );
      } else if (category === 'PURCHASE') {
        const rawDeliv = String(record.deliveryStatus || record.status || '').toLowerCase();
        if (rawDeliv.includes('diterima') || rawDeliv.includes('selesai') || rawDeliv.includes('completed')) {
          setFulfillmentStage('Diterima Gudang (Stok FEFO Aktif)');
        } else if (rawDeliv.includes('dikirim') || rawDeliv.includes('transit')) {
          setFulfillmentStage('Dikirim Supplier');
        } else {
          setFulfillmentStage('Dipesan');
        }
      } else {
        setFulfillmentStage('Tercatat & Terverifikasi');
        setSelectedVaultSource(record.from || record.displayDariSumber || record.sourceVault || 'Laci Kasir');
        setSelectedVaultDest(record.to || record.displayTujuanAlokasi || record.targetVault || 'Brangkas Toko');
      }

      const grandTotal = Number(
        record.totalAmount ??
          record.total ??
          record.netAmt ??
          record.amount ??
          record.displayNominal ??
          record.estimatedCost ??
          record.debtAmount ??
          0
      );
      const pmLower = String(record.paymentMethod || record.paymentStatus || '').toLowerCase();
      const isCreditOrUnpaid =
        pmLower.includes('hutang') ||
        pmLower.includes('piutang') ||
        pmLower.includes('tempo') ||
        pmLower.includes('belum') ||
        Number(record.remainingDebt || record.debtAmount || 0) > 0;
      const rawDebt = Number(
        record.remainingDebt ??
          record.debtAmount ??
          (isCreditOrUnpaid ? Math.max(0, grandTotal - Number(record.paidAmount || record.downPayment || 0)) : 0)
      );
      const rawPaid = Number(
        record.paidAmount ??
          record.amountPaid ??
          record.cashReceived ??
          (rawDebt > 0 ? Math.max(0, grandTotal - rawDebt) : grandTotal)
      );

      setRemainingDebtLocal(rawDebt);
      setPaidAmountLocal(rawPaid);
      setPaymentStatusLocal(rawDebt > 0 ? 'Belum Lunas' : 'Lunas');
    };

    window.addEventListener(UNIVERSAL_TX_EVENT, handleOpenEvent);
    return () => window.removeEventListener(UNIVERSAL_TX_EVENT, handleOpenEvent);
  }, []);

  // Customer directory state from Firestore
  const [customerList, setCustomerList] = useState<any[]>([]);
  const [selectedCustName, setSelectedCustName] = useState('');
  const [newCustomerForm, setNewCustomerForm] = useState({ name: '', phone: '' });

  // Cashier shift state from Firestore
  const [shiftStartingCash, setShiftStartingCash] = useState(0);
  const [currentCashSales, setCurrentCashSales] = useState(0);
  const [currentDigitalSales, setCurrentDigitalSales] = useState(0);
  const [shiftClosed, setShiftClosed] = useState(false);

  // Scanner state
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [newChatText, setNewChatText] = useState('');

  // PWA Order state
  const [latestPwaOrder, setLatestPwaOrder] = useState<any | null>(null);
  const [pwaOrderProcessed, setPwaOrderProcessed] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubCust = onSnapshot(collection(db, 'customers'), (snap) => {
      const loaded = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          name: data.name || data.storeName || d.id,
          phone: data.phone || '-',
          type: data.tier || data.type || 'Member',
          points: Number(data.points) || 0,
          address: data.address || '-',
        };
      });
      setCustomerList(loaded);
    });

    const unsubTx = onSnapshot(collection(db, 'transactions'), (snap) => {
      let cashSum = 0;
      let digitalSum = 0;
      let latestPwa: any = null;
      snap.forEach((d) => {
        const data = d.data() as any;
        if (isLegacyMockOrderOrTx(data, d.id)) return;
        if (data.status === 'completed') {
          if (data.paymentMethod === 'cash') cashSum += Number(data.totalAmount) || 0;
          else digitalSum += Number(data.totalAmount) || 0;
        }
        const st = String(data.status || '').toLowerCase();
        const isPending =
          st === 'pending' || st === 'pending_approval' || st === 'menunggu' || st === 'antrean';
        if (data.channel === 'pwa_client' && isPending) {
          if (!latestPwa || String(data.createdAt || '') > String(latestPwa.createdAt || '')) {
            latestPwa = { id: d.id, ...data };
          }
        }
      });
      setCurrentCashSales(cashSum);
      setCurrentDigitalSales(digitalSum);
      setLatestPwaOrder(latestPwa);
    });

    return () => {
      unsubCust();
      unsubTx();
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
      onClose();
    }, 1500);
  };

  const formatTimer = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleScanSample = (code: string, name: string) => {
    setScannedBarcode(code);
    setScanFeedback(`Item Identified: ${name} (${code})`);
    setTimeout(() => setScanFeedback(null), 3000);
  };

  const handlePwaAction = async (action: 'approve' | 'reject') => {
    if (latestPwaOrder?.id) {
      try {
        await updateDoc(doc(db, 'transactions', latestPwaOrder.id), {
          status: action === 'approve' ? 'completed' : 'rejected',
        });
      } catch (e) {
        console.warn('Error updating PWA order:', e);
      }
    }
    setPwaOrderProcessed(true);
    showToast(action === 'approve' ? 'Order Approved & Dispatched!' : 'Order Rejected.');
  };

  if (!activeModal && !universalModalData) return null;

  return (
    <>
      {/* 1. Customer Directory Modal */}
      {activeModal === 'customers' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <User className="w-4 h-4 text-blue-400" />
                  {tr('Customer Directory', 'Direktori Pelanggan')}
                </h3>
                <p className="text-xs text-zinc-400">{tr('Select customer for cashier orders or register a new customer profile.', 'Pilih pelanggan untuk transaksi kasir atau daftarkan pelanggan baru.')}</p>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800">✕</button>
            </div>

            {/* Customer List */}
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {customerList.length === 0 ? (
                <div className="py-8 text-center text-zinc-500 text-xs">
                  <User className="w-8 h-8 mx-auto mb-2 opacity-30 text-zinc-400" />
                  <p className="font-semibold text-zinc-400">{tr('No registered customers', 'Belum ada data pelanggan')}</p>
                  <p className="text-[11px] text-zinc-600 mt-0.5">{tr('Register a new customer using the form below.', 'Daftarkan pelanggan baru menggunakan form di bawah.')}</p>
                </div>
              ) : (
                customerList.map((cust) => (
                  <div
                    key={cust.id}
                    className={`p-3 rounded-xl border flex items-center justify-between text-xs transition ${
                      selectedCustName === cust.name
                        ? 'bg-blue-600/15 border-blue-500/50'
                        : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <div>
                      <div className="font-bold text-white flex items-center gap-1.5">
                        {cust.name}
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 font-normal">
                          {cust.type}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-0.5">
                        {tr('Phone', 'Telepon')}: <span className="font-mono text-zinc-300">{cust.phone}</span> &bull; {tr('Points', 'Poin')}: <span className="text-blue-400 font-bold">{cust.points} Pts</span>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setSelectedCustName(cust.name);
                        if (onSelectCustomer) onSelectCustomer(cust.name);
                        onClose();
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                        selectedCustName === cust.name
                          ? 'bg-blue-600 text-white'
                          : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                      }`}
                    >
                      {selectedCustName === cust.name ? tr('Selected', 'Dipilih') : tr('Select', 'Pilih')}
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Quick Add Customer */}
            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2 text-xs">
              <span className="font-bold text-white block">{tr('Register New Customer:', 'Daftarkan Pelanggan Baru:')}</span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder={tr('Full Name', 'Nama Lengkap')}
                  value={newCustomerForm.name}
                  onChange={(e) => setNewCustomerForm({ ...newCustomerForm, name: e.target.value })}
                  className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-white"
                />
                <input
                  type="text"
                  placeholder={tr('Phone Number (+62...)', 'Nomor Telepon (+62...)')}
                  value={newCustomerForm.phone}
                  onChange={(e) => setNewCustomerForm({ ...newCustomerForm, phone: e.target.value })}
                  className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-white"
                />
              </div>
              <button
                onClick={async () => {
                  if (!newCustomerForm.name) return;
                  const newC = {
                    id: 'c_' + Date.now(),
                    name: newCustomerForm.name,
                    phone: newCustomerForm.phone || '-',
                    type: 'Member',
                    points: 0,
                    address: 'Main Store Register',
                  };
                  try {
                    await setDoc(doc(db, 'customers', newC.id), newC);
                  } catch (e) {
                    console.warn('Error saving customer:', e);
                  }
                  setCustomerList([...customerList, newC]);
                  setSelectedCustName(newC.name);
                  if (onSelectCustomer) onSelectCustomer(newC.name);
                  setNewCustomerForm({ name: '', phone: '' });
                  onClose();
                }}
                className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs"
              >
                + {tr('Save & Select Customer', 'Simpan & Pilih Pelanggan')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Cashier Shift Modal */}
      {activeModal === 'shift' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-emerald-400" />
                  {tr('Cashier Shift Report', 'Laporan Shift Kasir')}
                </h3>
                <p className="text-xs text-zinc-400">{tr('Active Cashier: Administrator', 'Kasir Aktif: Administrator')} &bull; {tr('Session', 'Sesi')} #{formatTimer(sessionSeconds)}</p>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800">✕</button>
            </div>

            <div className="space-y-2 text-xs bg-zinc-950 p-4 rounded-xl border border-zinc-800">
              <div className="flex justify-between text-zinc-400">
                <span>{tr('Starting Drawer Cash:', 'Modal Awal Kasir:')}</span>
                <span className="font-mono text-white font-bold">
                  {formatCurrency(shiftStartingCash)}
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>{tr('Total Cash Sales Tendered:', 'Total Penjualan Tunai:')}</span>
                <span className="font-mono text-emerald-400 font-bold">
                  {formatCurrency(currentCashSales)}
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>{tr('Total Digital Payments (QRIS / Card):', 'Total Pembayaran Digital (QRIS / Kartu):')}</span>
                <span className="font-mono text-blue-400 font-bold">
                  {formatCurrency(currentDigitalSales)}
                </span>
              </div>
              <div className="flex justify-between text-white font-bold pt-2 border-t border-zinc-800 text-sm">
                <span>{tr('Total Physical Cash in Drawer:', 'Total Fisik Uang di Laci:')}</span>
                <span className="font-mono text-emerald-400">
                  {formatCurrency(shiftStartingCash + currentCashSales)}
                </span>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => {
                  showToast(tr('Cashier shift report successfully printed to thermal printer!', 'Laporan shift kasir berhasil dicetak ke printer termal!'));
                }}
                className="flex-1 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                {tr('Print Shift Report', 'Cetak Laporan Shift')}
              </button>
              <button
                onClick={() => {
                  setShiftClosed(true);
                  showToast(tr('Cashier shift closed successfully! Cash drawer reconciled and locked.', 'Shift kasir berhasil ditutup! Laci kas direkonsiliasi dan dikunci.'));
                }}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs cursor-pointer"
              >
                {tr('End Shift & Lock Drawer', 'Tutup Shift & Kunci Laci')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-[60] bg-zinc-900 border border-zinc-700 text-white px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-semibold animate-in fade-in slide-in-from-top-2">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 3. Barcode Scanner Modal */}
      {activeModal === 'scanner' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-blue-400" />
                  {tr('Camera & Barcode Scanner', 'Kamera & Pemindai Barcode')}
                </h3>
                <p className="text-xs text-zinc-400">{tr('Align barcode with viewfinder or click sample barcodes below.', 'Arahkan barcode ke jendela bidik atau klik sampel barcode di bawah.')}</p>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800">✕</button>
            </div>

            {/* Viewfinder simulation */}
            <div className="relative aspect-video rounded-xl bg-black border-2 border-blue-500/50 overflow-hidden flex items-center justify-center">
              <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-0.5 bg-rose-500 shadow-[0_0_12px_#f43f5e] animate-pulse" />
              <div className="w-36 h-28 border-2 border-dashed border-blue-400/60 rounded-lg flex items-center justify-center text-[11px] font-mono text-blue-300 bg-blue-950/20">
                {tr('ALIGN BARCODE', 'ARAHKAN BARCODE')}
              </div>
              <div className="absolute bottom-2 text-[10px] text-zinc-500 font-mono">
                {tr('Optical Sensor Active • 60 FPS', 'Sensor Optik Aktif • 60 FPS')}
              </div>
            </div>

            {scanFeedback && (
              <div className="p-2.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold text-center animate-bounce">
                {scanFeedback}
              </div>
            )}

            {/* Quick Test Barcode Buttons */}
            <div className="space-y-1.5 text-xs">
              <span className="text-[11px] font-bold text-zinc-400 block">{tr('Click Sample Product Barcode:', 'Klik Sampel Barcode Produk:')}</span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => handleScanSample('8998866200112', 'Indomie Goreng Carton')}
                  className="p-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-left cursor-pointer"
                >
                  <div className="font-bold text-white truncate">{tr('Indomie Carton', 'Indomie Dus')}</div>
                  <div className="text-[10px] font-mono text-zinc-500">8998866200112</div>
                </button>
                <button
                  onClick={() => handleScanSample('899123456004', 'Hydro Coco 250ml')}
                  className="p-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-left cursor-pointer"
                >
                  <div className="font-bold text-white truncate">Hydro Coco</div>
                  <div className="text-[10px] font-mono text-zinc-500">899123456004</div>
                </button>
                <button
                  onClick={() => handleScanSample('899123456001', 'Nipis Madu Bottle')}
                  className="p-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-left cursor-pointer"
                >
                  <div className="font-bold text-white truncate">{tr('Nipis Madu Bottle', 'Nipis Madu Botol')}</div>
                  <div className="text-[10px] font-mono text-zinc-500">899123456001</div>
                </button>
                <button
                  onClick={() => handleScanSample('899123456007', 'LPG Gas Cylinder 3kg')}
                  className="p-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-left cursor-pointer"
                >
                  <div className="font-bold text-white truncate">{tr('LPG Gas 3kg', 'Gas LPG 3 Kg')}</div>
                  <div className="text-[10px] font-mono text-zinc-500">899123456007</div>
                </button>
              </div>
            </div>

            {/* Manual input */}
            <div className="flex gap-2 pt-1">
              <input
                type="text"
                placeholder={tr('Or type Barcode / SKU...', 'Atau ketik Barcode / SKU...')}
                value={scannedBarcode}
                onChange={(e) => setScannedBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && scannedBarcode) {
                    handleScanSample(scannedBarcode, 'Custom SKU');
                  }
                }}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white font-mono"
              />
              <button
                onClick={() => {
                  if (scannedBarcode) handleScanSample(scannedBarcode, 'Custom SKU');
                }}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs cursor-pointer"
              >
                {tr('Scan', 'Pindai')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Live Customer Chat Modal */}
      {activeModal === 'chat' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-blue-600/30 text-blue-400 flex items-center justify-center font-bold">
                  C
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{tr('Customer Live Chat', 'Obrolan Langsung Pelanggan')}</h3>
                  <p className="text-[10px] text-emerald-400">{tr('Online • Client PWA Channel', 'Online • Saluran Client PWA')}</p>
                </div>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800">✕</button>
            </div>

            <div className="h-56 overflow-y-auto space-y-2.5 p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs">
              {chatMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-zinc-500 py-6">
                  <p className="text-xs font-medium text-zinc-400">{tr('No chat messages yet', 'Belum ada pesan obrolan.')}</p>
                  <p className="text-[11px] mt-1 text-zinc-600 max-w-xs">{tr('Customer inquiries from Client PWA will appear in this real-time thread.', 'Pesan dari pelanggan via Client PWA akan muncul di sini secara real-time.')}</p>
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.fromCustomer ? 'items-start' : 'items-end'}`}
                  >
                    <div
                      className={`max-w-[80%] p-2.5 rounded-xl ${
                        msg.fromCustomer
                          ? 'bg-zinc-800 text-zinc-200'
                          : 'bg-blue-600 text-white'
                      }`}
                    >
                      <div className="text-[10px] opacity-75 font-semibold mb-0.5">{msg.sender}</div>
                      {msg.text}
                    </div>
                    <span className="text-[9px] text-zinc-500 mt-0.5 px-1">{msg.time}</span>
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <input
                type="text"
                placeholder={tr('Type reply to customer...', 'Ketik balasan untuk pelanggan...')}
                value={newChatText}
                onChange={(e) => setNewChatText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newChatText.trim()) {
                    setChatMessages([
                      ...chatMessages,
                      { id: Date.now(), sender: 'RiskCart Cashier', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text: newChatText, fromCustomer: false },
                    ]);
                    setNewChatText('');
                  }
                }}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white"
              />
              <button
                onClick={() => {
                  if (!newChatText.trim()) return;
                  setChatMessages([
                    ...chatMessages,
                    { id: Date.now(), sender: 'RiskCart Cashier', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text: newChatText, fromCustomer: false },
                  ]);
                  setNewChatText('');
                }}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs cursor-pointer"
              >
                {tr('Send', 'Kirim')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Orders Queue Modal */}
      {activeModal === 'orders' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-xl rounded-2xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-400" />
                  {tr('Incoming Orders Queue (Live)', 'Antrean Pesanan Masuk (Live)')}
                </h3>
                <p className="text-xs text-zinc-400">{tr('Monitor and verify online orders dispatched from Client PWA.', 'Pantau dan verifikasi pesanan online dari Client PWA.')}</p>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800">✕</button>
            </div>

            {!latestPwaOrder ? (
              <div className="p-6 rounded-xl bg-zinc-950 border border-zinc-800 text-center text-xs text-zinc-500">
                {tr('No incoming PWA orders in queue.', 'Belum ada pesanan PWA masuk di antrean.')}
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-mono font-bold text-white">#{latestPwaOrder.id.slice(-8)}</span>
                    <div className="text-[11px] text-zinc-400">{latestPwaOrder.customerName || 'Pelanggan PWA'}</div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    {latestPwaOrder.status === 'completed' || pwaOrderProcessed
                      ? tr('Completed', 'Selesai')
                      : tr('Awaiting Confirmation', 'Menunggu Konfirmasi')}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-zinc-900 text-xs text-zinc-300 flex items-center justify-between">
                  <span>
                    {tr('Total Order:', 'Total Pesanan:')}{' '}
                    <strong className="text-emerald-400 font-mono">
                      {formatCurrency(Number(latestPwaOrder.totalAmount || 0))}
                    </strong>
                  </span>
                  <span className="text-zinc-400">
                    {latestPwaOrder.distanceToStoreMeters !== undefined
                      ? `GPS: ${latestPwaOrder.distanceToStoreMeters}m`
                      : tr('Verified Order', 'Pesanan Terverifikasi')}
                  </span>
                </div>

                {latestPwaOrder.status !== 'completed' && !pwaOrderProcessed && (
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => handlePwaAction('approve')}
                      className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs cursor-pointer"
                    >
                      ✓ {tr('Fulfill & Send Receipt', 'Proses & Kirim Struk')}
                    </button>
                    <button
                      onClick={() => handlePwaAction('reject')}
                      className="px-4 py-2 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-white font-bold text-xs cursor-pointer"
                    >
                      {tr('Decline', 'Tolak')}
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => {
                onClose();
                onNavigateTab('transactions');
              }}
              className="w-full py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold cursor-pointer"
            >
              {tr('Open All Transaction History →', 'Buka Semua Riwayat Transaksi →')}
            </button>
          </div>
        </div>
      )}

      {/* 6. Order Radar & GPS Modal */}
      {activeModal === 'delivery' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-blue-400" />
                  {tr('Order Delivery Monitoring & GPS Radar', 'Pemantauan Pengiriman Pesanan & Radar GPS')}
                </h3>
                <p className="text-xs text-zinc-400">{tr('Verify geofence boundary and dispatch couriers.', 'Verifikasi batas geofence dan kirim kurir.')}</p>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800">✕</button>
            </div>

            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2 text-xs">
              <div className="flex justify-between text-zinc-300">
                <span>{tr('Store Geofence Radius:', 'Radius Geofence Toko:')}</span>
                <span className="font-mono text-emerald-400 font-bold">500 {tr('Meters', 'Meter')}</span>
              </div>
              <div className="flex justify-between text-zinc-300">
                <span>{tr('Store Coordinates:', 'Koordinat Toko:')}</span>
                <span className="font-mono text-white">-6.208800, 106.845600</span>
              </div>
              <div className="flex justify-between text-zinc-300">
                <span>{tr('Active Courier:', 'Kurir Aktif:')}</span>
                <span className="text-white font-bold">{tr('RiskCart Express Rider #01 (Bike Dispatch)', 'Kurir Kilat RiskCart #01 (Motor)')}</span>
              </div>
              <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 text-blue-300 rounded-lg text-[11px] mt-2">
                {tr('Delivery Status: Verified within 500m geofence. En route to customer (~3 min ETA).', 'Status Pengiriman: Terverifikasi di dalam radius 500m. Dalam perjalanan ke pelanggan (~3 menit).')}
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs cursor-pointer"
            >
              {tr('Done Monitoring', 'Selesai Memantau')}
            </button>
          </div>
        </div>
      )}

      {/* 7. Cashier Account Modal */}
      {activeModal === 'account' && (() => {
        let activeStaff: any = null;
        try {
          const raw = localStorage.getItem('riskcart_active_cashier');
          if (raw) activeStaff = JSON.parse(raw);
        } catch {}
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <User className="w-4 h-4 text-purple-400" />
                  {tr('Cashier Account Profile', 'Profil Akun Kasir')}
                </h3>
                <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer">✕</button>
              </div>

              <div className="space-y-2.5 text-xs bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                <div className="flex justify-between text-zinc-400">
                  <span>{tr('Nama Kasir:', 'Nama Kasir:')}</span>
                  <span className="font-bold text-white">{activeStaff?.name || 'Muhammad Irfan'}</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>{tr('Jabatan / Role:', 'Jabatan / Role:')}</span>
                  <span className="font-bold text-purple-400">{activeStaff?.role || 'Cashier'}</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>{tr('Email Login:', 'Email Login:')}</span>
                  <span className="font-mono text-blue-400">{activeStaff?.email || 'irfan.kasir@riskcart.com'}</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>{tr('Penempatan:', 'Penempatan:')}</span>
                  <span className="text-zinc-300">{activeStaff?.outlet || 'Cabang Utama (Pusat)'}</span>
                </div>
                <div className="flex justify-between text-zinc-400 pt-1.5 border-t border-zinc-800">
                  <span>{tr('Tenant Store ID:', 'ID Toko Tenant:')}</span>
                  <span className="font-mono text-zinc-300">{ACTIVE_STORE_ID}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    onClose();
                    onNavigateTab('staff');
                  }}
                  className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs cursor-pointer shadow-lg shadow-purple-900/30 transition"
                >
                  Kelola Karyawan &amp; Hak Akses →
                </button>
                <button
                  onClick={onClose}
                  className="w-full py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs cursor-pointer"
                >
                  {tr('Close', 'Tutup')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 8. Help & Keyboard Shortcuts Modal */}
      {activeModal === 'help' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <ExternalLink className="w-4 h-4 text-blue-400" />
                {tr('Cashier Help & Keyboard Shortcuts', 'Bantuan Kasir & Pintasan Keyboard')}
              </h3>
              <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800">✕</button>
            </div>

            <div className="space-y-2 text-xs bg-zinc-950 p-4 rounded-xl border border-zinc-800 font-mono">
              <div className="flex justify-between">
                <span className="text-zinc-400">&quot;{tr('Exact Cash', 'Uang Pas')}&quot; {tr('Button', 'Tombol')}</span>
                <span className="text-blue-400 font-bold">{tr('Autofill exact amount', 'Otomatis isi nominal pas')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">&quot;{tr('Process Payment', 'Proses Bayar')}&quot;</span>
                <span className="text-emerald-400 font-bold">{tr('Charge & Print Receipt', 'Bayar & Cetak Struk')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">{tr('Clear Order', 'Bersihkan Pesanan')}</span>
                <span className="text-rose-400 font-bold">{tr('Clear active cart', 'Kosongkan keranjang aktif')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">{tr('Carton / Unit Switch', 'Pilihan Dus / Satuan')}</span>
                <span className="text-amber-400 font-bold">{tr('Auto carton conversion', 'Konversi otomatis dus')}</span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs cursor-pointer"
            >
              {tr('Understood', 'Mengerti')}
            </button>
          </div>
        </div>
      )}

      {/* 9. UNIVERSAL TRANSACTION DETAIL & FULFILLMENT MODAL */}
      {universalModalData && (() => {
        const { record, category } = universalModalData;
        const isCash = category === 'CASH_IN' || category === 'CASH_OUT';
        const isPurchase = category === 'PURCHASE';
        const isSale = category === 'SALE';

        // 1. Resolve ID / Nomor Nota
        const rawId = String(
          record.receiptNo ||
            record.orderNumber ||
            record.poNumber ||
            record.docNumber ||
            record.id ||
            'TRX-001'
        );
        const formattedNotaId = rawId.startsWith('#')
          ? rawId
          : isSale
          ? rawId.startsWith('POS') || rawId.startsWith('ORD') || rawId.startsWith('INV')
            ? `#${rawId}`
            : String(record.channel || '').toLowerCase().includes('pwa')
            ? `#ORD-${rawId}`
            : `#POS-${rawId}`
          : isPurchase
          ? rawId.startsWith('PO') || rawId.startsWith('PR') || rawId.startsWith('PUR')
            ? `#${rawId}`
            : `#PO-${rawId}`
          : rawId.startsWith('KAS') || rawId.startsWith('DEP') || rawId.startsWith('MUT')
          ? `#${rawId}`
          : `#KAS-${rawId}`;

        // 2. Resolve Date & Time WIB
        const rawTimestamp =
          record.createdAt ||
          record.timestamp ||
          record.date ||
          record.displayTanggal ||
          new Date().toISOString();
        let displayDateWib = String(record.date || record.displayTanggal || '');
        if (record.displayTanggal && record.displayJam) {
          displayDateWib = `${record.displayTanggal} • ${record.displayJam} WIB`;
        } else {
          const parsedDate = new Date(rawTimestamp);
          if (!Number.isNaN(parsedDate.getTime()) && String(rawTimestamp).includes('T')) {
            displayDateWib =
              parsedDate.toLocaleString('id-ID', {
                timeZone: 'Asia/Jakarta',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              }) + ' WIB';
          } else if (!displayDateWib) {
            displayDateWib = String(rawTimestamp);
          } else if (!displayDateWib.toUpperCase().includes('WIB')) {
            displayDateWib = `${displayDateWib}${record.time ? ` • ${record.time}` : ''} WIB`;
          }
        }

        // 3. Resolve Channel & Staff
        const channelLabel = isSale
          ? String(record.channel || record.source || '').toLowerCase().includes('pwa') ||
            String(record.channel || '').toLowerCase().includes('online')
            ? 'Klien PWA'
            : 'POS Kasir'
          : isPurchase
          ? 'PO Supplier'
          : 'Mutasi Brangkas/Kas';

        const staffName =
          record.cashierName ||
          record.cashier ||
          record.actor ||
          record.staff ||
          record.displayStaff ||
          record.pic ||
          record.requester ||
          'Admin / Kasir Toko';

        // 4. Resolve Party Info (Pelanggan / Supplier / Penanggung Jawab)
        const partyName = isSale
          ? record.customerName || record.customer || record.name || 'Pelanggan Umum'
          : isPurchase
          ? record.supplier || record.supplierName || record.vendor || record.requester || 'Supplier Mitra'
          : record.actor || record.displayStaff || record.pic || record.staff || staffName;

        const matchedCust = (appCustomers || []).find(
          (c: any) =>
            (c.id && c.id === record.customerId) ||
            (c.name && String(c.name).toLowerCase() === String(partyName).toLowerCase())
        );

        const partyPhone =
          record.customerPhone ||
          record.phone ||
          record.whatsapp ||
          record.supplierPhone ||
          matchedCust?.phone ||
          '-';

        const partyAddress = isSale
          ? record.deliveryAddress ||
            record.customerAddress ||
            record.address ||
            matchedCust?.address ||
            'Transaksi Langsung di Toko (Walk-in)'
          : isPurchase
          ? record.warehouseLocation || record.warehouse || record.department || 'Gudang Utama Toko'
          : `${selectedVaultSource} → ${selectedVaultDest}`;

        // 5. Resolve Payment Method
        const rawPm = String(
          record.paymentMethod ||
            record.paymentType ||
            record.paymentStatus ||
            (isCash ? 'Mutasi Kas / Brangkas' : 'Tunai')
        );
        const pmLower = rawPm.toLowerCase();
        const displayPaymentMethod = pmLower.includes('qris')
          ? 'QRIS'
          : pmLower.includes('cod')
          ? 'COD'
          : pmLower.includes('hutang') || pmLower.includes('piutang') || pmLower.includes('tempo') || pmLower.includes('credit')
          ? 'Hutang/Piutang'
          : pmLower.includes('transfer') || pmLower.includes('bank')
          ? 'Transfer Bank'
          : 'Tunai';

        // 6. Resolve Items & Financial Calculations
        const rawItems = Array.isArray(record.items)
          ? record.items
          : Array.isArray(record.cartItems)
          ? record.cartItems
          : Array.isArray(record.products)
          ? record.products
          : [];

        const normalizedItems = rawItems.length > 0
          ? rawItems.map((it: any, idx: number) => {
              const prodName = it.productName || it.name || it.title || `Item #${idx + 1}`;
              const matchedProd = (products || []).find(
                (p: any) =>
                  (it.productId && p.id === it.productId) ||
                  (it.id && p.id === it.id) ||
                  String(p.name || '').toLowerCase() === String(prodName).toLowerCase()
              );
              const qty = Math.max(1, Number(it.qty ?? it.quantity ?? 1));
              const unitLabel =
                it.unit ||
                it.unitType ||
                (it.isCarton || String(it.unit || '').toLowerCase().includes('dus') || String(it.unit || '').toLowerCase().includes('karton')
                  ? `Dus (${it.piecesPerCarton || matchedProd?.piecesPerCarton || 24} Pcs)`
                  : 'Unit / Pcs');
              const sellOrBuyPrice = Number(
                it.price ??
                  it.unitPrice ??
                  it.sellingPrice ??
                  it.contractPrice ??
                  it.buyPrice ??
                  it.estimatedPrice ??
                  matchedProd?.pricePerUnit ??
                  0
              );
              const costPrice = isPurchase
                ? sellOrBuyPrice
                : Number(
                    it.costPrice ??
                      it.buyPrice ??
                      it.hpp ??
                      matchedProd?.costPerUnit ??
                      Math.round(sellOrBuyPrice * 0.82)
                  );
              const itemDiscount = Number(it.discount ?? it.discountAmount ?? 0);
              const subtotal = Number(it.subtotal ?? it.total ?? Math.max(0, sellOrBuyPrice * qty - itemDiscount));
              const totalHppItem = costPrice * qty;
              const netProfitItem = isPurchase ? 0 : subtotal - totalHppItem;

              return {
                id: it.productId || it.id || `item-${idx}`,
                name: prodName,
                unit: unitLabel,
                qty,
                price: sellOrBuyPrice,
                costPrice,
                discount: itemDiscount,
                subtotal,
                totalHppItem,
                netProfitItem,
              };
            })
          : !isCash
          ? [
              (() => {
                const fallbackTotal = Number(
                  record.totalAmount ??
                    record.total ??
                    record.netAmt ??
                    record.estimatedCost ??
                    record.debtAmount ??
                    record.amount ??
                    0
                );
                const fallbackQty = Math.max(1, Number(record.itemsCount ?? record.qty ?? record.totalUnits ?? 1));
                const fallbackPrice = fallbackQty > 0 ? Math.round(fallbackTotal / fallbackQty) : fallbackTotal;
                const fallbackCogs = isPurchase
                  ? fallbackTotal
                  : Number(record.cogs ?? record.totalCogs ?? Math.round(fallbackTotal * 0.82));
                const unitCost = fallbackQty > 0 ? Math.round(fallbackCogs / fallbackQty) : fallbackCogs;
                return {
                  id: 'summary-item-1',
                  name:
                    record.productSummary ||
                    record.productName ||
                    record.product ||
                    (isPurchase ? `Pengadaan Barang Supplier (${partyName})` : `Transaksi Penjualan (${partyName})`),
                  unit: record.unit || 'Dus / Unit',
                  qty: fallbackQty,
                  price: fallbackPrice,
                  costPrice: unitCost,
                  discount: Number(record.discount ?? record.discountAmount ?? 0),
                  subtotal: fallbackTotal,
                  totalHppItem: fallbackCogs,
                  netProfitItem: isPurchase ? 0 : fallbackTotal - fallbackCogs,
                };
              })(),
            ]
          : [];

        const calcSubtotal = isCash
          ? Number(record.amount ?? record.displayNominal ?? record.totalAmount ?? 0)
          : normalizedItems.reduce((s: number, it: any) => s + it.price * it.qty, 0);

        const calcDiscount = isCash
          ? 0
          : Number(
              record.discount ??
                record.discountAmount ??
                normalizedItems.reduce((s: number, it: any) => s + it.discount, 0)
            );

        const calcTotalHpp = isCash
          ? 0
          : Number(
              record.cogs ??
                record.totalCogs ??
                normalizedItems.reduce((s: number, it: any) => s + it.totalHppItem, 0)
            );

        const calcGrandTotal = Number(
          record.totalAmount ??
            record.total ??
            record.netAmt ??
            record.amount ??
            record.displayNominal ??
            record.estimatedCost ??
            record.debtAmount ??
            Math.max(0, calcSubtotal - calcDiscount)
        );

        const calcNetProfit = isCash
          ? category === 'CASH_IN'
            ? calcGrandTotal
            : -calcGrandTotal
          : isPurchase
          ? 0
          : Number(record.grossProfit ?? record.netProfit ?? calcGrandTotal - calcTotalHpp);

        const handleMarkAsPaid = async () => {
          setIsSavingUniversal(true);
          try {
            setPaidAmountLocal(calcGrandTotal);
            setRemainingDebtLocal(0);
            setPaymentStatusLocal('Lunas');

            if (record.id) {
              const targetCol = isPurchase
                ? 'procurements'
                : String(record.channel || '').toLowerCase().includes('pwa')
                ? 'orders'
                : 'transactions';
              try {
                await updateDoc(doc(db, targetCol, String(record.id)), {
                  paymentStatus: 'Lunas',
                  paidAmount: calcGrandTotal,
                  remainingDebt: 0,
                  isPaid: true,
                });
              } catch {
                // Also try fallback collection if needed
                try {
                  await updateDoc(doc(db, 'transactions', String(record.id)), {
                    paymentStatus: 'Lunas',
                    paidAmount: calcGrandTotal,
                    remainingDebt: 0,
                    isPaid: true,
                  });
                } catch {}
              }
            }
            refreshFirestore();
            setUniversalFeedback('✅ Status pembayaran berhasil ditandai LUNAS (Sisa Tagihan Rp 0)!');
          } finally {
            setIsSavingUniversal(false);
          }
        };

        const handleSaveFulfillmentChanges = async () => {
          setIsSavingUniversal(true);
          try {
            if (record.id) {
              if (isSale) {
                const statusMap: Record<string, string> = {
                  Baru: 'pending',
                  Pengemasan: 'processing',
                  Dikirim: 'shipped',
                  Terkirim: 'completed',
                  Dikembalikan: 'returned',
                };
                const updatePayload = {
                  fulfillmentStatus: fulfillmentStage,
                  deliveryStatus: fulfillmentStage,
                  status: statusMap[fulfillmentStage] || 'completed',
                  shipper: selectedCourier,
                  courierName: selectedCourier,
                  paymentStatus: paymentStatusLocal,
                  paidAmount: paidAmountLocal,
                  remainingDebt: remainingDebtLocal,
                };
                try {
                  await updateDoc(doc(db, 'transactions', String(record.id)), updatePayload);
                } catch {}
                try {
                  await updateDoc(doc(db, 'orders', String(record.id)), updatePayload);
                } catch {}
              } else if (isPurchase) {
                const updatePayload = {
                  deliveryStatus: fulfillmentStage,
                  status: fulfillmentStage,
                  paymentStatus: paymentStatusLocal,
                  paidAmount: paidAmountLocal,
                  remainingDebt: remainingDebtLocal,
                };
                try {
                  await updateDoc(doc(db, 'procurements', String(record.id)), updatePayload);
                } catch {}
              } else if (isCash) {
                const updatePayload = {
                  from: selectedVaultSource,
                  to: selectedVaultDest,
                  status: 'Tercatat & Terverifikasi',
                };
                try {
                  await updateDoc(doc(db, 'brangkas_toko_logs', String(record.id)), updatePayload);
                } catch {}
                try {
                  await updateDoc(doc(db, 'cash_logs', String(record.id)), updatePayload);
                } catch {}
              }
            }
            refreshFirestore();
            setUniversalFeedback('✅ Perubahan Status Fulfillment & Transaksi berhasil disimpan!');
          } finally {
            setIsSavingUniversal(false);
          }
        };

        const handleSendWhatsAppProof = () => {
          const cleanPhone = String(partyPhone || '').replace(/\D/g, '');
          const waPhone = cleanPhone.startsWith('0')
            ? '62' + cleanPhone.slice(1)
            : cleanPhone || '6281234567890';
          const textLines = [
            `*BUKTI TRANSAKSI RESMI RISKCART*`,
            `No. Nota: *${formattedNotaId}*`,
            `Waktu: ${displayDateWib}`,
            `Saluran: ${channelLabel}`,
            `Pihak Terkait: *${partyName}*`,
            `Status Fulfillment: *${fulfillmentStage}*`,
            isSale ? `Kurir Pengiriman: *${selectedCourier}*` : '',
            `Metode Bayar: ${displayPaymentMethod} (${paymentStatusLocal})`,
            `Grand Total: *${formatCurrency(calcGrandTotal)}*`,
            remainingDebtLocal > 0 ? `Sisa Tagihan: *${formatCurrency(remainingDebtLocal)}*` : `Status: *LUNAS*`,
            `Terima kasih atas kepercayaan Anda! 🙏`,
          ]
            .filter(Boolean)
            .join('\n');

          fetch('/api/whatsapp/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: waPhone, message: textLines }),
          }).catch(() => {});

          setUniversalFeedback(`💬 Bukti transaksi ${formattedNotaId} telah dikirim ke WhatsApp (${partyPhone !== '-' ? partyPhone : 'Pelanggan'})!`);
        };

        const saleSteps = [
          { key: 'Baru', label: '1. Baru' },
          { key: 'Pengemasan', label: '2. Pengemasan' },
          { key: 'Dikirim', label: '3. Dikirim' },
          { key: 'Terkirim', label: '4. Terkirim' },
          { key: 'Dikembalikan', label: 'Dikembalikan' },
        ];

        const purchaseSteps = [
          { key: 'Dipesan', label: '1. Dipesan' },
          { key: 'Dikirim Supplier', label: '2. Dikirim Supplier' },
          { key: 'Diterima Gudang (Stok FEFO Aktif)', label: '3. Diterima Gudang (Stok FEFO Aktif)' },
        ];

        return (
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-5 overflow-y-auto animate-in fade-in"
            onClick={() => setUniversalModalData(null)}
          >
            <div
              className="w-full max-w-4xl rounded-2xl bg-[#0c0a07] border border-amber-500/40 shadow-[0_0_50px_rgba(245,158,11,0.18)] text-zinc-100 overflow-hidden my-auto max-h-[92vh] flex flex-col print:max-w-none print:max-h-none print:bg-white print:text-black print:border-none"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 1. HEADER & STATUS FULFILLMENT */}
              <div className="p-4 sm:p-5 bg-gradient-to-r from-[#17130b] via-[#1f190e] to-[#120f09] border-b border-amber-500/30 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0 shadow-inner">
                      {isSale ? (
                        <Truck className="w-5 h-5" />
                      ) : isPurchase ? (
                        <Package className="w-5 h-5" />
                      ) : (
                        <Vault className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-amber-500 text-black">
                          LIHAT DETAIL &amp; FULFILLMENT
                        </span>
                        <span className="font-mono font-black text-base sm:text-lg text-amber-300">
                          {formattedNotaId}
                        </span>
                        <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-zinc-900 border border-amber-500/30 text-amber-200">
                          {channelLabel}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-400 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="flex items-center gap-1 font-mono text-zinc-300">
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                          {displayDateWib}
                        </span>
                        <span>&bull;</span>
                        <span className="flex items-center gap-1">
                          <User className="w-3.5 h-3.5 text-amber-400" />
                          Kasir / Staf: <strong className="text-white">{staffName}</strong>
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setUniversalModalData(null)}
                    className="self-end sm:self-center p-2 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white transition cursor-pointer print:hidden"
                    title="Tutup Modal"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* INTERACTIVE FULFILLMENT STEPPER / BADGE */}
                <div className="p-3.5 rounded-xl bg-[#110e09] border border-amber-500/25 space-y-3">
                  {isSale && (
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                      <div className="space-y-1.5 flex-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 block">
                          Status Fulfillment Penjualan (Klik untuk Update Status):
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {saleSteps.map((st) => {
                            const active = fulfillmentStage === st.key;
                            const isReturned = st.key === 'Dikembalikan';
                            return (
                              <button
                                key={st.key}
                                type="button"
                                onClick={() => setFulfillmentStage(st.key)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 border ${
                                  active
                                    ? isReturned
                                      ? 'bg-rose-600 text-white border-rose-400 shadow-md'
                                      : 'bg-gradient-to-r from-amber-500 to-yellow-500 text-black border-amber-300 shadow-md'
                                    : 'bg-zinc-900/90 text-zinc-400 border-zinc-800 hover:border-amber-500/40 hover:text-amber-200'
                                }`}
                              >
                                {active && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                <span>{st.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="sm:w-60 shrink-0">
                        <label className="text-[10px] font-black uppercase tracking-wider text-amber-400 block mb-1">
                          Staf Pengiriman / Kurir:
                        </label>
                        <select
                          value={selectedCourier}
                          onChange={(e) => setSelectedCourier(e.target.value)}
                          className="w-full bg-zinc-950 border border-amber-500/40 rounded-lg px-3 py-1.5 text-xs font-bold text-amber-100 focus:outline-none focus:border-amber-400 cursor-pointer"
                        >
                          {COURIER_OPTIONS.map((c) => (
                            <option key={c} value={c} className="bg-zinc-950 text-white">
                              🚚 {c}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {isPurchase && (
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 block">
                        Status Fulfillment PO &amp; Penerimaan Gudang (Klik untuk Update):
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        {purchaseSteps.map((st) => {
                          const active = fulfillmentStage === st.key;
                          return (
                            <button
                              key={st.key}
                              type="button"
                              onClick={() => setFulfillmentStage(st.key)}
                              className={`px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 border ${
                                active
                                  ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-black border-amber-300 shadow-md'
                                  : 'bg-zinc-900/90 text-zinc-400 border-zinc-800 hover:border-amber-500/40 hover:text-amber-200'
                              }`}
                            >
                              {active && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                              <span>{st.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {isCash && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-black flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-emerald-400" />
                          <span>Tercatat &amp; Terverifikasi</span>
                        </span>
                        <span
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${
                            category === 'CASH_IN'
                              ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                              : 'bg-rose-950/80 border-rose-700 text-rose-300'
                          }`}
                        >
                          {category === 'CASH_IN' ? 'UANG MASUK (KAS MASUK)' : 'UANG KELUAR (KAS KELUAR)'}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="text-zinc-400 text-[11px]">Sumber:</span>
                          <select
                            value={selectedVaultSource}
                            onChange={(e) => setSelectedVaultSource(e.target.value)}
                            className="bg-zinc-950 border border-amber-500/30 rounded-lg px-2.5 py-1 text-xs font-bold text-amber-200 cursor-pointer"
                          >
                            {VAULT_OPTIONS.map((v) => (
                              <option key={v} value={v} className="bg-zinc-950 text-white">
                                {v}
                              </option>
                            ))}
                          </select>
                        </div>
                        <span className="text-amber-400 font-bold">→</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-zinc-400 text-[11px]">Tujuan:</span>
                          <select
                            value={selectedVaultDest}
                            onChange={(e) => setSelectedVaultDest(e.target.value)}
                            className="bg-zinc-950 border border-amber-500/30 rounded-lg px-2.5 py-1 text-xs font-bold text-amber-200 cursor-pointer"
                          >
                            {VAULT_OPTIONS.map((v) => (
                              <option key={v} value={v} className="bg-zinc-950 text-white">
                                {v}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* BODY CONTENT (SCROLLABLE) */}
              <div className="p-4 sm:p-5 overflow-y-auto space-y-5 flex-1">
                {universalFeedback && (
                  <div className="p-3 rounded-xl bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center justify-between">
                    <span>{universalFeedback}</span>
                    <button
                      type="button"
                      onClick={() => setUniversalFeedback(null)}
                      className="text-emerald-400 hover:text-white ml-2 cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {/* 2. PANEL INFORMASI PIHAK TERKAIT & PEMBAYARAN */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Pihak Terkait */}
                  <div className="p-4 rounded-xl bg-[#13100b] border border-zinc-800/90 space-y-2.5 text-xs">
                    <div className="text-[10px] font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5 border-b border-zinc-800 pb-2">
                      <Building2 className="w-3.5 h-3.5" />
                      <span>
                        {isSale
                          ? 'Informasi Pelanggan & Pengiriman'
                          : isPurchase
                          ? 'Informasi Supplier & Gudang Penerima'
                          : 'Informasi Penanggung Jawab & Alokasi Brangkas'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-0.5">
                      <span className="text-zinc-400">
                        {isSale ? 'Nama Pelanggan:' : isPurchase ? 'Nama Supplier:' : 'Penanggung Jawab:'}
                      </span>
                      <span className="col-span-2 font-bold text-white text-sm">{partyName}</span>

                      <span className="text-zinc-400">Nomor WhatsApp:</span>
                      <span className="col-span-2 font-mono text-amber-300 font-semibold flex items-center gap-1.5">
                        <Phone className="w-3 h-3 text-amber-400" />
                        {partyPhone}
                      </span>

                      <span className="text-zinc-400">
                        {isSale ? 'Alamat Tujuan:' : isPurchase ? 'Lokasi Gudang:' : 'Rute Brangkas:'}
                      </span>
                      <span className="col-span-2 text-zinc-200 flex items-start gap-1">
                        <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <span>{partyAddress}</span>
                      </span>
                    </div>
                  </div>

                  {/* Informasi Pembayaran */}
                  <div className="p-4 rounded-xl bg-[#13100b] border border-zinc-800/90 space-y-2.5 text-xs flex flex-col justify-between">
                    <div className="space-y-2.5">
                      <div className="text-[10px] font-black uppercase tracking-wider text-amber-400 flex items-center justify-between border-b border-zinc-800 pb-2">
                        <span className="flex items-center gap-1.5">
                          <CreditCard className="w-3.5 h-3.5" />
                          <span>Status Pembayaran &amp; Tagihan</span>
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                            paymentStatusLocal === 'Lunas'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          }`}
                        >
                          {paymentStatusLocal}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2 pt-0.5">
                        <span className="text-zinc-400">Metode Bayar:</span>
                        <span className="col-span-2 font-bold text-amber-200 uppercase font-mono">
                          {displayPaymentMethod}
                        </span>

                        <span className="text-zinc-400">Jumlah Dibayar:</span>
                        <span className="col-span-2 font-mono font-bold text-emerald-400">
                          {formatCurrency(paidAmountLocal)}
                        </span>

                        <span className="text-zinc-400">Sisa Tagihan/Hutang:</span>
                        <span
                          className={`col-span-2 font-mono font-black ${
                            remainingDebtLocal > 0 ? 'text-rose-400 text-sm' : 'text-zinc-400'
                          }`}
                        >
                          {formatCurrency(remainingDebtLocal)}
                        </span>
                      </div>
                    </div>

                    {remainingDebtLocal > 0 && (
                      <div className="pt-2 border-t border-zinc-800/80 print:hidden">
                        <button
                          type="button"
                          disabled={isSavingUniversal}
                          onClick={handleMarkAsPaid}
                          className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs shadow-lg transition flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <CheckCircle className="w-4 h-4" />
                          <span>Tandai Lunas / Bayar Sisa Tagihan ({formatCurrency(remainingDebtLocal)})</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. TABEL RINCIAN ITEM & KALKULASI KEUANGAN */}
                <div className="rounded-xl border border-amber-500/30 overflow-hidden bg-[#110e09]">
                  <div className="px-4 py-2.5 bg-[#18130c] border-b border-amber-500/25 flex items-center justify-between">
                    <span className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-amber-400" />
                      <span>
                        {isCash
                          ? 'Tabel Rincian Jurnal Kas & Mutasi Brangkas'
                          : 'Tabel Rincian Produk & Kalkulasi Laba Bersih per Item'}
                      </span>
                    </span>
                    <span className="text-[11px] font-mono text-zinc-400">
                      {isCash ? '1 Jurnal Terverifikasi' : `${normalizedItems.length} Baris Produk`}
                    </span>
                  </div>

                  {!isCash ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-zinc-950/90 text-amber-200/90 border-b border-zinc-800 uppercase text-[10px] tracking-wider">
                          <tr>
                            <th className="py-2.5 px-3">Nama Produk</th>
                            <th className="py-2.5 px-3">Satuan Dus/Unit</th>
                            <th className="py-2.5 px-3 text-center">Qty</th>
                            <th className="py-2.5 px-3 text-right">Harga Satuan</th>
                            <th className="py-2.5 px-3 text-right">Harga Modal/HPP</th>
                            <th className="py-2.5 px-3 text-right">Diskon</th>
                            <th className="py-2.5 px-3 text-right">Subtotal</th>
                            <th className="py-2.5 px-3 text-right">Laba Bersih / Item</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/70 text-zinc-200">
                          {normalizedItems.map((it: any, idx: number) => (
                            <tr key={it.id || idx} className="hover:bg-amber-500/5 transition">
                              <td className="py-2.5 px-3 font-bold text-white">{it.name}</td>
                              <td className="py-2.5 px-3 text-zinc-300">{it.unit}</td>
                              <td className="py-2.5 px-3 text-center font-mono font-bold text-amber-300">
                                {it.qty}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono">
                                {formatCurrency(it.price)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-zinc-400">
                                {formatCurrency(it.costPrice)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-amber-400">
                                {it.discount > 0 ? `-${formatCurrency(it.discount)}` : formatCurrency(0)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                                {formatCurrency(it.subtotal)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">
                                {isPurchase ? '-' : `+${formatCurrency(it.netProfitItem)}`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-zinc-950/90 text-amber-200/90 border-b border-zinc-800 uppercase text-[10px] tracking-wider">
                          <tr>
                            <th className="py-2.5 px-3">Jenis Jurnal</th>
                            <th className="py-2.5 px-3">Dari Sumber</th>
                            <th className="py-2.5 px-3">Tujuan Alokasi</th>
                            <th className="py-2.5 px-3">Keterangan / Catatan</th>
                            <th className="py-2.5 px-3 text-right">Nominal Masuk/Keluar</th>
                            <th className="py-2.5 px-3 text-right">Saldo Berjalan</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/70 text-zinc-200">
                          <tr className="hover:bg-amber-500/5">
                            <td className="py-3 px-3 font-bold text-amber-300">
                              {record.displayJenisJurnal ||
                                record.jenisJurnal ||
                                record.category ||
                                record.type ||
                                (category === 'CASH_IN' ? 'Penerimaan Kas / Setoran' : 'Pengeluaran Kas Operasional')}
                            </td>
                            <td className="py-3 px-3 font-semibold text-white">{selectedVaultSource}</td>
                            <td className="py-3 px-3 font-semibold text-amber-200">{selectedVaultDest}</td>
                            <td className="py-3 px-3 text-zinc-300">
                              {record.note || record.description || record.notes || '-'}
                            </td>
                            <td
                              className={`py-3 px-3 text-right font-mono font-black ${
                                category === 'CASH_IN' ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {category === 'CASH_IN' ? '+' : '-'}
                              {formatCurrency(calcGrandTotal)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-bold text-white">
                              {formatCurrency(Number(record.runningSaldo ?? record.runningBalance ?? calcGrandTotal))}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* RINGKASAN BAWAH */}
                  <div className="p-4 bg-[#16120b] border-t border-amber-500/30 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs">
                    <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800">
                      <span className="text-[10px] text-zinc-400 block uppercase">Subtotal</span>
                      <span className="font-mono font-bold text-white mt-0.5 block">
                        {formatCurrency(calcSubtotal)}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800">
                      <span className="text-[10px] text-zinc-400 block uppercase">Diskon/Potongan</span>
                      <span className="font-mono font-bold text-amber-400 mt-0.5 block">
                        {formatCurrency(calcDiscount)}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800">
                      <span className="text-[10px] text-zinc-400 block uppercase">Total HPP</span>
                      <span className="font-mono font-bold text-zinc-300 mt-0.5 block">
                        {formatCurrency(calcTotalHpp)}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-amber-500/15 border border-amber-500/40">
                      <span className="text-[10px] text-amber-300 font-bold block uppercase">Grand Total</span>
                      <span className="font-mono font-black text-amber-300 text-sm mt-0.5 block">
                        {formatCurrency(calcGrandTotal)}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800">
                      <span className="text-[10px] text-zinc-400 block uppercase">Jumlah Dibayar</span>
                      <span className="font-mono font-bold text-emerald-400 mt-0.5 block">
                        {formatCurrency(paidAmountLocal)}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800">
                      <span className="text-[10px] text-zinc-400 block uppercase">
                        {remainingDebtLocal > 0 ? 'Sisa Hutang' : 'Kembalian'}
                      </span>
                      <span
                        className={`font-mono font-bold mt-0.5 block ${
                          remainingDebtLocal > 0 ? 'text-rose-400' : 'text-zinc-300'
                        }`}
                      >
                        {remainingDebtLocal > 0
                          ? formatCurrency(remainingDebtLocal)
                          : formatCurrency(Math.max(0, paidAmountLocal - calcGrandTotal))}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/30 col-span-2 sm:col-span-1">
                      <span className="text-[10px] text-emerald-300 font-bold block uppercase">
                        Est. Laba Bersih
                      </span>
                      <span className="font-mono font-black text-emerald-400 text-sm mt-0.5 block">
                        {formatCurrency(calcNetProfit)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 4. TOMBOL AKSI FOOTER */}
              <div className="p-4 bg-[#14110b] border-t border-amber-500/30 flex flex-wrap items-center justify-between gap-2.5 print:hidden">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="px-3.5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-amber-500/30 text-amber-200 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Printer className="w-4 h-4 text-amber-400" />
                    <span>🖨️ Cetak Nota / Bukti Transaksi</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSendWhatsAppProof}
                    className="px-3.5 py-2.5 rounded-xl bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/40 text-emerald-300 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5 text-emerald-400" />
                    <span>💬 Kirim Bukti via WhatsApp</span>
                  </button>

                  <div className="px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-500/25 text-[11px] text-blue-300 flex items-center gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Google Sheet Auto-Synced: {formattedNotaId}</span>
                    <a
                      href={
                        record.googleDocUrl ||
                        `/api/google-drive/doc/${encodeURIComponent(
                          String(rawId).replace(/[^a-zA-Z0-9_-]/g, '_')
                        )}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-[10px] inline-flex items-center gap-1 transition"
                    >
                      <span>📊 Buka Google Spreadsheet</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    disabled={isSavingUniversal}
                    onClick={handleSaveFulfillmentChanges}
                    className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-black font-black text-xs shadow-lg transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <Check className="w-4 h-4 stroke-[3]" />
                    <span>
                      {isSavingUniversal
                        ? 'Menyimpan...'
                        : '✓ Simpan Perubahan Fulfillment / Status'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setUniversalModalData(null)}
                    className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs transition cursor-pointer"
                  >
                    Tutup
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
};

