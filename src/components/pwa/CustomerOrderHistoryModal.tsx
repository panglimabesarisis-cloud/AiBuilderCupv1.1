import React, { useState, useEffect } from 'react';
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { Transaction, TransactionItem, Product } from '../../types';
import {
  PackageCheck,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  ChevronRight,
  RefreshCw,
  ShoppingBag,
  MapPin,
  QrCode,
  CreditCard,
  Boxes,
  Truck,
  Store,
  Receipt,
  RotateCcw,
  Sparkles,
  ExternalLink,
  MessageSquare,
  Check,
  X,
  Package,
  Phone,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { useLanguage } from '../../context/LanguageContext';
import { ACTIVE_STORE_ID } from '../../config/store';

// Robust phone normalization helper for Indonesian formats (+62, 62, 08, dashes, spaces)
export const normalizePhone = (p?: string): string => {
  if (!p) return '';
  let digits = p.replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) digits = '62' + digits.slice(1);
  if (digits.startsWith('8')) digits = '62' + digits;
  return digits;
};

export type FulfillmentStageType = 'pending' | 'processing' | 'prepared' | 'ready' | 'shipped' | 'completed' | 'rejected';

export interface FulfillmentInfo {
  status: FulfillmentStageType;
  step: number; // 1 to 5
  percentage: number; // 20, 40, 60, 80, 100
  label: string;
  subLabel: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  barColor: string;
  isFailed: boolean;
  estimatedText: string;
}

export const getFulfillmentInfo = (tx: Transaction, langParam?: 'en' | 'id'): FulfillmentInfo => {
  const storedLang =
    typeof window !== 'undefined'
      ? localStorage.getItem('riskcart-language') || localStorage.getItem('riskcart_lang_v2')
      : 'en';
  const lang = langParam || (storedLang === 'id' ? 'id' : 'en');

  // If explicitly flagged or rejected
  if (tx.status === 'rejected' || (tx as any).status === 'cancelled') {
    return {
      status: 'rejected',
      step: 1,
      percentage: 100,
      label: lang === 'id' ? 'Pesanan Ditolak / Batal' : 'Order Rejected / Cancelled',
      subLabel: lang === 'id' ? 'Pesanan telah dibatalkan oleh kasir atau sistem.' : 'Order was cancelled by store cashier or system.',
      badgeBg: 'bg-rose-500/20',
      badgeText: 'text-rose-400',
      badgeBorder: 'border-rose-500/40',
      barColor: 'bg-rose-500',
      isFailed: true,
      estimatedText: lang === 'id' ? 'Dibatalkan' : 'Cancelled',
    };
  }

  if (tx.status === 'flagged_fraud') {
    return {
      status: 'pending',
      step: 1,
      percentage: 20,
      label: lang === 'id' ? 'Pemeriksaan Anti-Fraud' : 'Anti-Fraud Review',
      subLabel: lang === 'id' ? 'Menunggu verifikasi radius lokasi & pola belanja.' : 'Verifying geofence radius and shopping pattern.',
      badgeBg: 'bg-amber-500/20',
      badgeText: 'text-amber-400',
      badgeBorder: 'border-amber-500/40',
      barColor: 'bg-amber-500',
      isFailed: false,
      estimatedText: lang === 'id' ? 'Dalam Peninjauan' : 'Under Review',
    };
  }

  // Derive from fulfillmentStatus or fallback to tx.status
  const rawStatus = (tx.fulfillmentStatus || tx.status || 'pending').toLowerCase();

  // Stage 5: Selesai / Completed
  if (rawStatus === 'completed' || rawStatus === 'delivered' || rawStatus === 'selesai') {
    return {
      status: 'completed',
      step: 5,
      percentage: 100,
      label: lang === 'id' ? 'Selesai' : 'Completed',
      subLabel: lang === 'id' ? 'Pesanan telah diterima dengan baik dan transaksi tuntas.' : 'Order has been received and transaction is complete.',
      badgeBg: 'bg-emerald-500/20',
      badgeText: 'text-emerald-400',
      badgeBorder: 'border-emerald-500/40',
      barColor: 'bg-emerald-500',
      isFailed: false,
      estimatedText: lang === 'id' ? 'Telah Diterima' : 'Completed & Received',
    };
  }

  // Stage 4: Pesanan Dikirim / Shipped
  if (rawStatus === 'shipped' || rawStatus === 'dikirim' || rawStatus === 'on_delivery') {
    return {
      status: 'shipped',
      step: 4,
      percentage: 80,
      label: lang === 'id' ? 'Pesanan Dikirim' : 'Order Shipped',
      subLabel: lang === 'id' ? 'Kurir toko sedang mengantarkan pesanan menuju titik GPS Anda.' : 'Store courier is delivering your order to your GPS pin.',
      badgeBg: 'bg-cyan-500/20',
      badgeText: 'text-cyan-400',
      badgeBorder: 'border-cyan-500/40',
      barColor: 'bg-cyan-500',
      isFailed: false,
      estimatedText: lang === 'id' ? 'Dalam Perjalanan Kurir' : 'In Transit by Courier',
    };
  }

  // Stage 3: Pesanan Disiapkan / Prepared / Ready
  if (rawStatus === 'ready' || rawStatus === 'prepared' || rawStatus === 'packing' || rawStatus === 'disiapkan') {
    return {
      status: 'ready',
      step: 3,
      percentage: 60,
      label: lang === 'id' ? 'Pesanan Disiapkan' : 'Order Prepared',
      subLabel: lang === 'id' ? 'Barang grosir/eceran telah selesai disiapkan dan siap dikirim.' : 'Wholesale/retail items are packed and ready for dispatch.',
      badgeBg: 'bg-indigo-500/20',
      badgeText: 'text-indigo-400',
      badgeBorder: 'border-indigo-500/40',
      barColor: 'bg-indigo-500',
      isFailed: false,
      estimatedText: lang === 'id' ? 'Siap Dikirim / Diambil' : 'Ready for Dispatch',
    };
  }

  // Stage 2: Pesanan Diproses / Processing
  if (rawStatus === 'processing' || rawStatus === 'diproses') {
    return {
      status: 'processing',
      step: 2,
      percentage: 40,
      label: lang === 'id' ? 'Pesanan Diproses' : 'Order Processed',
      subLabel: lang === 'id' ? 'Kasir & gudang sedang memproses daftar pesanan Anda.' : 'Cashier & warehouse team are processing your order.',
      badgeBg: 'bg-blue-500/20',
      badgeText: 'text-blue-400',
      badgeBorder: 'border-blue-500/40',
      barColor: 'bg-blue-500',
      isFailed: false,
      estimatedText: lang === 'id' ? 'Estimasi: 5-10 menit' : 'Est: 5-10 mins',
    };
  }

  // Stage 1: Pesanan Dibuat / Order Created (pending / new / pending_approval)
  return {
    status: 'pending',
    step: 1,
    percentage: 20,
    label: lang === 'id' ? 'Pesanan Dibuat' : 'Order Created',
    subLabel: lang === 'id' ? 'Pesanan baru berhasil dibuat dan masuk ke antrean POS.' : 'New order created and queued in POS system.',
    badgeBg: 'bg-amber-500/20',
    badgeText: 'text-amber-400',
    badgeBorder: 'border-amber-500/40',
    barColor: 'bg-amber-500',
    isFailed: false,
    estimatedText: lang === 'id' ? 'Menunggu diproses kasir' : 'Awaiting cashier processing',
  };
};

interface CustomerOrderHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerPhone?: string;
  onReorder?: (items: { product: Product; packageType: 'carton' | 'unit'; quantity: number }[]) => void;
  availableProducts: Product[];
}

export const CustomerOrderHistoryModal: React.FC<CustomerOrderHistoryModalProps> = ({
  isOpen,
  onClose,
  customerPhone,
  onReorder,
  availableProducts,
}) => {
  const { tr, formatCurrency } = useLanguage();
  const [orders, setOrders] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedOrder, setSelectedOrder] = useState<Transaction | null>(null);
  const [orderItems, setOrderItems] = useState<TransactionItem[]>([]);
  const [loadingItems, setLoadingItems] = useState<boolean>(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<boolean>(false);

  // Currency helper
  const formatMoney = (val: number) => formatCurrency(val);

  // Real-time listener strictly for customer's PWA orders from transactions and store orders
  useEffect(() => {
    if (!isOpen) return;

    const targetPhoneNorm = normalizePhone(customerPhone);
    if (!targetPhoneNorm || targetPhoneNorm.length < 8) {
      setOrders([]);
      setSelectedOrder(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    let txOrders: Transaction[] = [];
    let storeOrders: Transaction[] = [];

    const updateCombined = () => {
      const map = new Map<string, Transaction>();
      [...storeOrders, ...txOrders].forEach((item) => {
        map.set(item.id, item);
      });
      const combined = Array.from(map.values()).sort(
        (a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime()
      );
      setOrders(combined);

      // Update selectedOrder reactively if it exists in list
      setSelectedOrder((prev) => {
        if (!prev) {
          return combined.length > 0 ? combined[0] : null;
        }
        const matched = combined.find((o) => o.id === prev.id);
        return matched || (combined.length > 0 ? combined[0] : null);
      });
      setLoading(false);
    };

    const qTx = query(
      collection(db, 'transactions'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubTx = onSnapshot(
      qTx,
      (snapshot) => {
        const matching: Transaction[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as Omit<Transaction, 'id'>;
          if (data.channel === 'pwa_client' || data.channel === 'client_pwa') {
            const docPhoneNorm = normalizePhone(data.customerPhone);
            if (docPhoneNorm && docPhoneNorm === targetPhoneNorm) {
              matching.push({
                id: docSnap.id,
                ...data,
              });
            }
          }
        });
        txOrders = matching;
        updateCombined();
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'transactions');
        setLoading(false);
      }
    );

    const qOrders = query(
      collection(db, `stores/${ACTIVE_STORE_ID}/orders`),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubOrders = onSnapshot(
      qOrders,
      (snapshot) => {
        const matching: Transaction[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as any;
          const phone = data.customerPhone || data.deliveryDetails?.phone || '';
          const docPhoneNorm = normalizePhone(phone);
          if (docPhoneNorm && docPhoneNorm === targetPhoneNorm) {
            matching.push({
              id: docSnap.id,
              storeId: data.storeId || ACTIVE_STORE_ID,
              outletId: data.outletId || 'out_1',
              channel: 'pwa_client',
              customerName: data.customerName || data.deliveryDetails?.recipientName || 'Member PWA',
              customerPhone: phone,
              totalAmount: data.totalAmount || 0,
              totalCost: data.totalCost || Math.round((data.totalAmount || 0) * 0.7),
              paymentMethod: data.paymentMethod || 'qris',
              status: data.status || 'pending_approval',
              fulfillmentStatus: data.fulfillmentStatus || 'pending',
              fraudScore: data.fraudScore || 8,
              fraudFlags: data.fraudFlags || ['PWA_VERIFIED_MEMBER'],
              riskLevel: data.riskLevel || 'clean',
              items: data.items || [],
              createdAt: data.createdAt || data.timestamp || new Date().toISOString(),
              aiExplanation: data.aiExplanation || '',
            });
          }
        });
        storeOrders = matching;
        updateCombined();
      },
      (error) => {
        console.warn(`stores/${ACTIVE_STORE_ID}/orders onSnapshot notice:`, error);
      }
    );

    return () => {
      unsubTx();
      unsubOrders();
    };
  }, [isOpen, customerPhone]);

  // Fetch items whenever selectedOrder changes
  useEffect(() => {
    if (!selectedOrder) {
      setOrderItems([]);
      return;
    }

    // If order already has embedded items, use them immediately
    if (selectedOrder.items && selectedOrder.items.length > 0) {
      setOrderItems(selectedOrder.items);
      setLoadingItems(false);
      return;
    }

    let isMounted = true;
    setLoadingItems(true);

    async function fetchItems() {
      try {
        const snap = await getDocs(collection(db, 'transactions', selectedOrder!.id, 'items'));
        const items: TransactionItem[] = [];
        snap.forEach((d) => items.push({ id: d.id, ...(d.data() as Omit<TransactionItem, 'id'>) }));

        if (isMounted) {
          setOrderItems(items);
          setLoadingItems(false);
        }
      } catch (err) {
        console.warn('Could not fetch items subcollection:', err);
        if (isMounted) setLoadingItems(false);
      }
    }

    fetchItems();
    return () => {
      isMounted = false;
    };
  }, [selectedOrder?.id]);

  if (!isOpen) return null;

  // Handle reorder
  const handleReorderClick = () => {
    if (!onReorder || orderItems.length === 0) return;
    const itemsToReorder = orderItems.map((oi) => {
      const prod = availableProducts.find((p) => p.id === oi.productId) || {
        id: oi.productId,
        storeId: oi.storeId || 'store_demo_default',
        name: oi.productName,
        sku: 'SKU-REORDER',
        category: 'Groceries',
        barcode: '',
        piecesPerCarton: oi.packageType === 'carton' ? (oi.unitsDeducted / oi.quantityOrdered || 40) : 1,
        stockInUnits: 100,
        costPerUnit: oi.unitPrice * 0.7,
        pricePerUnit: oi.unitPrice,
        pricePerCarton: oi.unitPrice,
        minStockAlert: 10,
      };
      return {
        product: prod,
        packageType: oi.packageType,
        quantity: oi.quantityOrdered,
      };
    });

    onReorder(itemsToReorder);
    onClose();
  };

  // Simulate updating fulfillment stage in real-time in Firestore
  const handleSimulateStageChange = async (targetStage: 'pending' | 'processing' | 'ready' | 'completed') => {
    if (!selectedOrder || isUpdatingStatus) return;
    setIsUpdatingStatus(true);

    try {
      const orderRef = doc(db, 'transactions', selectedOrder.id);
      await updateDoc(orderRef, {
        fulfillmentStatus: targetStage,
        status: targetStage === 'completed' ? 'completed' : 'pending_approval',
        updatedAt: new Date().toISOString(),
      });

      if (targetStage === 'completed') {
        try {
          confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
        } catch (e) {}
      }
    } catch (err) {
      console.error('Error updating fulfillment status:', err);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const currentInfo = selectedOrder ? getFulfillmentInfo(selectedOrder) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-4 animate-in fade-in">
      <div
        className="w-full max-w-4xl h-[90vh] max-h-[850px] rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, #161006 0%, #090603 100%)',
          border: '1.5px solid rgba(255, 200, 82, 0.45)',
          boxShadow: '0 20px 55px rgba(0, 0, 0, 0.85), 0 0 32px rgba(255, 185, 45, 0.2)',
        }}
      >
        {/* Modal Top Header */}
        <div
          className="px-5 sm:px-6 py-4 flex items-center justify-between shrink-0"
          style={{
            background: 'rgba(24, 18, 9, 0.94)',
            borderBottom: '1px solid rgba(255, 200, 82, 0.25)',
          }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: 'rgba(255, 200, 75, 0.16)',
                border: '1px solid rgba(255, 200, 82, 0.45)',
                color: '#ffd86b',
              }}
            >
              <Receipt className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-extrabold text-white tracking-tight flex items-center gap-2">
                <span>{tr('Order History & Fulfillment Tracker', 'Riwayat Pesanan & Fulfillment Tracker')}</span>
                <span
                  className="text-[10px] font-bold px-2.5 py-0.5 rounded-full hidden sm:inline-flex items-center gap-1"
                  style={{
                    background: 'rgba(15, 55, 34, 0.78)',
                    border: '1px solid rgba(80, 220, 145, 0.45)',
                    color: '#7df0b0',
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {tr('Real-Time Live', 'Real-Time Live')}
                </span>
              </h2>
              <p className="text-xs" style={{ color: '#b7ad99' }}>
                {tr(
                  'Monitor order fulfillment, verify store GPS boundaries, and track packing in real-time.',
                  'Pantau status pesanan, verifikasi GPS toko, dan progres pengemasan secara langsung.'
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl transition cursor-pointer"
            style={{
              background: 'rgba(20, 15, 8, 0.85)',
              border: '1px solid rgba(255, 200, 82, 0.4)',
              color: '#f7f3ea',
            }}
            aria-label={tr('Close', 'Tutup')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body: Left Order Selector & Right Tracker Details */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Left Column: Order History List with Real-time Progress Bar for Each Order */}
          <div
            className="w-full md:w-80 shrink-0 border-b md:border-b-0 md:border-r overflow-y-auto p-3.5 space-y-2.5"
            style={{
              background: 'rgba(11, 8, 4, 0.88)',
              borderColor: 'rgba(255, 200, 82, 0.22)',
            }}
          >
            {/* Logged In Member Phone Info Card */}
            <div
              className="p-3 rounded-2xl text-xs space-y-1.5"
              style={{
                background: 'rgba(24, 18, 9, 0.85)',
                border: '1px solid rgba(255, 200, 82, 0.35)',
              }}
            >
              <div className="flex items-center justify-between text-[11px]">
                <span style={{ color: '#b7ad99' }}>{tr('Real-Time Sync:', 'Sinkronisasi Real-Time:')}</span>
                <span className="text-[10px] font-bold flex items-center gap-1" style={{ color: '#25e08c' }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {tr('Live Active', 'Live Aktif')}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px]" style={{ color: '#8f8470' }}>
                  {tr('WhatsApp Number:', 'Nomor WhatsApp:')}
                </span>
                <span
                  className="font-mono font-bold text-xs px-2 py-0.5 rounded-md"
                  style={{
                    background: 'rgba(255, 200, 75, 0.16)',
                    border: '1px solid rgba(255, 200, 82, 0.4)',
                    color: '#ffd86b',
                  }}
                >
                  {customerPhone || tr('Public', 'Umum')}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs font-bold px-1 mb-1" style={{ color: '#b7ad99' }}>
              <span>
                {tr('Order List', 'Daftar Pesanan')} ({orders.length})
              </span>
              <span>
                {tr('Order List', 'Daftar Pesanan')} ({orders.length})
              </span>
            </div>

            {loading ? (
              <div className="py-12 text-center text-xs flex flex-col items-center" style={{ color: '#b7ad99' }}>
                <RefreshCw className="w-5 h-5 animate-spin mb-2" style={{ color: '#ffd86b' }} />
                {tr('Loading real-time order data...', 'Mengambil data pesanan real-time...')}
              </div>
            ) : orders.length === 0 ? (
              <div className="py-10 px-3 text-center text-xs flex flex-col items-center" style={{ color: '#b7ad99' }}>
                <ShoppingBag className="w-8 h-8 mx-auto mb-2" style={{ color: '#ffd86b' }} />
                <p className="font-bold text-white">
                  {tr('No orders yet for this number', 'Belum ada pesanan untuk nomor ini')}
                </p>
                <p className="text-[10px] font-mono mt-0.5" style={{ color: '#ffd86b' }}>
                  {customerPhone || '-'}
                </p>
                <p className="text-[10px] mt-2 max-w-[220px] leading-relaxed" style={{ color: '#b7ad99' }}>
                  {tr(
                    'Orders created via AI Order or PWA checkout will appear here in real-time.',
                    'Pesanan yang dibuat via Pesan AI atau checkout PWA akan otomatis muncul di sini secara real-time.'
                  )}
                </p>
              </div>
            ) : (
              orders.map((ord) => {
                const isSelected = selectedOrder?.id === ord.id;
                const ordInfo = getFulfillmentInfo(ord);

                return (
                  <button
                    key={ord.id}
                    type="button"
                    onClick={() => setSelectedOrder(ord)}
                    className="w-full text-left p-3 rounded-2xl transition-all flex flex-col justify-between cursor-pointer"
                    style={
                      isSelected
                        ? {
                            background: 'linear-gradient(135deg, rgba(48, 34, 12, 0.92), rgba(22, 16, 7, 0.96))',
                            border: '1.5px solid #ffd86b',
                            boxShadow: '0 0 18px rgba(255, 185, 45, 0.25)',
                          }
                        : {
                            background: 'rgba(18, 14, 8, 0.85)',
                            border: '1px solid rgba(255, 200, 82, 0.25)',
                          }
                    }
                  >
                    {/* Card Top: Order ID & Fulfillment Badge */}
                    <div className="flex items-start justify-between w-full gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-mono font-black text-white">#{ord.id.slice(-8)}</span>
                        </div>
                        <div className="text-[11px] mt-0.5" style={{ color: '#b7ad99' }}>
                          {new Date(ord.createdAt).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>

                      {/* Real-Time Fulfillment Status Badge */}
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0 flex items-center gap-1"
                        style={
                          ordInfo.isFailed
                            ? {
                                background: 'rgba(90, 22, 16, 0.75)',
                                border: '1px solid rgba(255, 123, 102, 0.5)',
                                color: '#ffb4a6',
                              }
                            : ordInfo.status === 'completed'
                            ? {
                                background: 'rgba(15, 55, 34, 0.85)',
                                border: '1px solid rgba(80, 220, 145, 0.5)',
                                color: '#7df0b0',
                              }
                            : {
                                background: 'rgba(255, 200, 75, 0.18)',
                                border: '1px solid rgba(255, 210, 95, 0.5)',
                                color: '#ffd86b',
                              }
                        }
                      >
                        {!ordInfo.isFailed && ordInfo.status !== 'completed' && (
                          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#ffd86b' }} />
                        )}
                        <span>{ordInfo.status}</span>
                        <span className="opacity-80">({ordInfo.percentage}%)</span>
                      </span>
                    </div>

                    {/* Progress Bar for Each Order */}
                    <div className="w-full mt-2.5 mb-1.5">
                      <div className="flex items-center justify-between text-[10px] mb-1">
                        <span className="truncate pr-1 font-medium" style={{ color: '#f7f3ea' }}>
                          {ordInfo.label}
                        </span>
                        <span className="font-mono font-bold shrink-0" style={{ color: '#ffd86b' }}>
                          {ordInfo.percentage}%
                        </span>
                      </div>
                      <div
                        className="w-full h-1.5 rounded-full overflow-hidden"
                        style={{ background: 'rgba(10, 8, 4, 0.95)', border: '1px solid rgba(255, 200, 82, 0.2)' }}
                      >
                        <div
                          className="h-full transition-all duration-500 rounded-full"
                          style={{
                            width: `${ordInfo.percentage}%`,
                            background:
                              ordInfo.status === 'completed'
                                ? 'linear-gradient(90deg, #1fc77e, #4ef0a6)'
                                : 'linear-gradient(90deg, #e5b13a, #ffd86b)',
                          }}
                        />
                      </div>
                    </div>

                    {/* Card Footer: Payment method & Total Price */}
                    <div
                      className="pt-2 flex items-center justify-between text-xs w-full"
                      style={{ borderTop: '1px solid rgba(255, 200, 82, 0.16)' }}
                    >
                      <span className="font-mono text-[10px] uppercase flex items-center gap-1" style={{ color: '#b7ad99' }}>
                        <CreditCard className="w-3 h-3" style={{ color: '#f4b63d' }} />
                        {ord.paymentMethod}
                      </span>
                      <span className="font-extrabold font-mono" style={{ color: '#ffd86b' }}>
                        {formatMoney(ord.totalAmount)}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Right Column: Live Fulfillment Tracker & Detailed Timeline */}
          {selectedOrder && currentInfo ? (
            <div className="flex-1 p-5 sm:p-6 overflow-y-auto space-y-5">
              {/* Top Summary Banner */}
              <div
                className="p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                style={{
                  background: 'rgba(20, 15, 8, 0.9)',
                  border: '1.5px solid rgba(255, 200, 82, 0.35)',
                }}
              >
                <div>
                  <div className="text-[10px] uppercase font-bold tracking-wider" style={{ color: '#b7ad99' }}>
                    {tr('Transaction Reference No.', 'Nomor Referensi Transaksi')}
                  </div>
                  <div className="text-base sm:text-lg font-black text-white font-mono mt-0.5">
                    #{selectedOrder.id}
                  </div>
                  <div className="text-xs mt-0.5 flex items-center gap-2" style={{ color: '#b7ad99' }}>
                    <span>
                      {tr('Ordered:', 'Dipesan:')} {new Date(selectedOrder.createdAt).toLocaleString()}
                    </span>
                    <span>&bull;</span>
                    <span className="font-bold" style={{ color: '#ffd86b' }}>
                      RiskCart PWA
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-[10px] uppercase font-semibold" style={{ color: '#b7ad99' }}>
                      {tr('Total Bill', 'Total Tagihan')}
                    </div>
                    <div className="text-lg sm:text-xl font-black font-mono" style={{ color: '#ffd86b' }}>
                      {formatMoney(selectedOrder.totalAmount)}
                    </div>
                  </div>

                  {/* Anti-Fraud Telemetry Shield Badge */}
                  <div
                    className="px-3 py-2 rounded-xl flex items-center gap-2"
                    style={
                      selectedOrder.fraudScore >= 70
                        ? {
                            background: 'rgba(90, 22, 16, 0.75)',
                            border: '1px solid rgba(255, 123, 102, 0.5)',
                            color: '#ffb4a6',
                          }
                        : {
                            background: 'rgba(15, 55, 34, 0.78)',
                            border: '1px solid rgba(80, 220, 145, 0.5)',
                            color: '#7df0b0',
                          }
                    }
                  >
                    {selectedOrder.fraudScore >= 70 ? (
                      <ShieldAlert className="w-5 h-5 shrink-0" style={{ color: '#ff7b66' }} />
                    ) : (
                      <ShieldCheck className="w-5 h-5 shrink-0" style={{ color: '#25e08c' }} />
                    )}
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider">
                        {selectedOrder.fraudScore >= 70 ? 'Risk Alert' : 'Verified Order'}
                      </div>
                      <div className="text-[10px] opacity-80">Score: {selectedOrder.fraudScore}/100</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* LIVE FULFILLMENT TRACKER & MULTI-STAGE PROGRESS BAR */}
              <div
                className="p-5 rounded-2xl space-y-4"
                style={{
                  background: 'rgba(18, 14, 8, 0.9)',
                  border: '1.5px solid rgba(255, 200, 82, 0.35)',
                }}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4" style={{ color: '#ffd86b' }} />
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-white">
                      Live Fulfillment Status
                    </h3>
                  </div>

                  {/* Status Badge */}
                  <div
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold"
                    style={
                      currentInfo.status === 'completed'
                        ? {
                            background: 'rgba(15, 55, 34, 0.85)',
                            border: '1px solid rgba(80, 220, 145, 0.55)',
                            color: '#7df0b0',
                          }
                        : {
                            background: 'rgba(255, 200, 75, 0.18)',
                            border: '1px solid rgba(255, 210, 95, 0.5)',
                            color: '#ffd86b',
                          }
                    }
                  >
                    {!currentInfo.isFailed && currentInfo.status !== 'completed' && (
                      <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#ffd86b' }} />
                    )}
                    <span>{currentInfo.label}</span>
                    <span className="font-mono opacity-90">({currentInfo.percentage}%)</span>
                  </div>
                </div>

                <p className="text-xs leading-relaxed" style={{ color: '#f7f3ea' }}>
                  {currentInfo.subLabel}
                </p>

                {/* Animated Horizontal Progress Bar Track */}
                <div className="space-y-1 pt-1">
                  <div className="flex items-center justify-between text-[11px] font-mono" style={{ color: '#b7ad99' }}>
                    <span>Progress: {currentInfo.percentage}%</span>
                    <span style={{ color: '#ffd86b' }}>{currentInfo.estimatedText}</span>
                  </div>
                  <div
                    className="w-full h-2.5 rounded-full overflow-hidden relative shadow-inner"
                    style={{ background: 'rgba(10, 8, 4, 0.95)', border: '1px solid rgba(255, 200, 82, 0.25)' }}
                  >
                    <div
                      className="h-full transition-all duration-700 ease-out rounded-full relative"
                      style={{
                        width: `${currentInfo.percentage}%`,
                        background:
                          currentInfo.status === 'completed'
                            ? 'linear-gradient(90deg, #1fc77e, #4ef0a6)'
                            : 'linear-gradient(90deg, #e5b13a, #ffd86b)',
                      }}
                    >
                      <div className="absolute inset-0 bg-white/15 animate-pulse" />
                    </div>
                  </div>
                </div>

                {/* 4-Stage Stepper Checkpoints */}
                <div
                  className="grid grid-cols-4 gap-2 text-center pt-3"
                  style={{ borderTop: '1px solid rgba(255, 200, 82, 0.2)' }}
                >
                  {[
                    { step: 1, titleEn: 'Pending', titleId: 'Pending', subEn: 'Received POS', subId: 'Diterima POS' },
                    { step: 2, titleEn: 'Processing', titleId: 'Diproses', subEn: 'Packing Items', subId: 'Sedang Dikemas' },
                    { step: 3, titleEn: 'Ready', titleId: 'Siap', subEn: 'Ready to Ship', subId: 'Siap Dikirim' },
                    { step: 4, titleEn: 'Completed', titleId: 'Selesai', subEn: 'Order Done', subId: 'Pesanan Selesai' },
                  ].map((s) => {
                    const reached = currentInfo.step >= s.step;
                    return (
                      <div key={s.step} className="space-y-1.5 flex flex-col items-center">
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-black transition-all"
                          style={
                            reached
                              ? {
                                  background:
                                    s.step === 4
                                      ? 'linear-gradient(135deg, #25e08c, #14995c)'
                                      : 'linear-gradient(135deg, #ffe28a, #d89820)',
                                  color: '#1b1204',
                                  boxShadow: '0 0 12px rgba(255, 185, 45, 0.35)',
                                }
                              : {
                                  background: 'rgba(10, 8, 4, 0.9)',
                                  border: '1px solid rgba(255, 200, 82, 0.25)',
                                  color: '#8f8470',
                                }
                          }
                        >
                          {currentInfo.step > s.step ? <Check className="w-4 h-4 stroke-[3]" /> : s.step}
                        </div>
                        <span className="text-[11px] font-bold text-white">{tr(s.titleEn, s.titleId)}</span>
                        <span className="text-[10px] hidden sm:inline" style={{ color: '#b7ad99' }}>
                          {tr(s.subEn, s.subId)}
                        </span>
                      </div>
                    );
                  })}
                </div>



                {/* Location & Geofence GPS Details */}
                <div
                  className="pt-3 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                  style={{ borderTop: '1px solid rgba(255, 200, 82, 0.2)', color: '#b7ad99' }}
                >
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" style={{ color: '#ffd86b' }} />
                    <span>{tr('RiskCart Store Radius: 500m', 'Radius Toko RiskCart: 500m')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedOrder.distanceToStoreMeters !== undefined && (
                      <span className="font-mono text-white">
                        {tr('Customer GPS:', 'GPS Pelanggan:')} {selectedOrder.distanceToStoreMeters}
                        {tr('m from store', 'm dari toko')}
                      </span>
                    )}
                    {selectedOrder.customerLatitude && selectedOrder.customerLongitude && (
                      <a
                        href={`https://www.google.com/maps?q=${selectedOrder.customerLatitude},${selectedOrder.customerLongitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline flex items-center gap-1 text-[10px] font-bold"
                        style={{ color: '#ffd86b' }}
                      >
                        <ExternalLink className="w-3 h-3" />
                        {tr('Maps Pin', 'Peta Maps')}
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* Itemized Order Breakdown */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-extrabold text-white">
                  <span>{tr('Order Item Details', 'Daftar Barang Pesanan')}</span>
                  <span className="font-normal" style={{ color: '#b7ad99' }}>
                    {orderItems.length} {tr('product types', 'jenis produk')}
                  </span>
                </div>

                {loadingItems ? (
                  <div className="p-4 text-center text-xs" style={{ color: '#b7ad99' }}>
                    <RefreshCw className="w-4 h-4 animate-spin inline mr-2" style={{ color: '#ffd86b' }} />
                    {tr('Fetching product details...', 'Mengambil rincian produk...')}
                  </div>
                ) : orderItems.length === 0 ? (
                  <div
                    className="p-4 rounded-xl text-xs text-center"
                    style={{
                      background: 'rgba(18, 14, 8, 0.85)',
                      border: '1px solid rgba(255, 200, 82, 0.25)',
                      color: '#b7ad99',
                    }}
                  >
                    {tr(
                      'Product details recorded in cashier terminal transaction.',
                      'Rincian produk tercatat di transaksi terminal kasir.'
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {orderItems.map((it, idx) => (
                      <div
                        key={it.id || idx}
                        className="p-3 rounded-xl flex items-center justify-between text-xs"
                        style={{
                          background: 'rgba(18, 14, 8, 0.88)',
                          border: '1px solid rgba(255, 200, 82, 0.3)',
                        }}
                      >
                        <div className="space-y-0.5">
                          <div className="font-bold text-white">{it.productName}</div>
                          <div className="flex items-center gap-2 text-[10px]" style={{ color: '#b7ad99' }}>
                            <span
                              className="px-1.5 py-0.5 rounded font-bold uppercase"
                              style={{
                                background: 'rgba(255, 200, 75, 0.16)',
                                border: '1px solid rgba(255, 200, 82, 0.4)',
                                color: '#ffd86b',
                              }}
                            >
                              {it.packageType === 'carton'
                                ? tr('Carton / Box', 'Dus / Karton')
                                : tr('Unit / Pcs', 'Satuan')}
                            </span>
                            <span>
                              {it.quantityOrdered}x @ {formatMoney(it.unitPrice)}
                            </span>
                            {it.packageType === 'carton' && (
                              <span style={{ color: '#8f8470' }}>({it.unitsDeducted} pcs)</span>
                            )}
                          </div>
                        </div>

                        <div className="font-extrabold font-mono" style={{ color: '#ffd86b' }}>
                          {formatMoney(it.subtotal)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* AI Verification Note */}
              {selectedOrder.aiExplanation && (
                <div
                  className="p-3.5 rounded-xl text-xs space-y-1"
                  style={{
                    background: 'rgba(18, 14, 8, 0.88)',
                    border: '1px solid rgba(255, 200, 82, 0.3)',
                  }}
                >
                  <div className="text-[10px] uppercase font-bold flex items-center gap-1" style={{ color: '#ffd86b' }}>
                    <Sparkles className="w-3 h-3" />
                    <span>{tr('Verification & Anti-Fraud Note', 'Catatan Verifikasi & Anti-Fraud')}</span>
                  </div>
                  <p className="leading-relaxed italic text-[11px]" style={{ color: '#b7ad99' }}>
                    &quot;{selectedOrder.aiExplanation}&quot;
                  </p>
                </div>
              )}

              {/* Action Buttons at Bottom */}
              <div
                className="pt-3 flex flex-wrap items-center justify-between gap-3"
                style={{ borderTop: '1px solid rgba(255, 200, 82, 0.22)' }}
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer"
                    style={{
                      background: 'rgba(24, 18, 9, 0.9)',
                      border: '1px solid rgba(255, 200, 82, 0.4)',
                      color: '#f7f3ea',
                    }}
                  >
                    {tr('Print Receipt Copy', 'Cetak Salinan Nota')}
                  </button>

                  {selectedOrder.customerPhone && (
                    <a
                      href={`https://wa.me/${normalizePhone(selectedOrder.customerPhone)}?text=${encodeURIComponent(
                        tr(
                          `Hello RiskCart Cashier, I would like to check the status of my order #${selectedOrder.id.slice(-8)} (Status: ${currentInfo.label}).`,
                          `Halo Kasir RiskCart, saya ingin konfirmasi status pesanan saya #${selectedOrder.id.slice(-8)} (Status: ${currentInfo.label}).`
                        )
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
                      style={{
                        background: 'rgba(15, 55, 34, 0.85)',
                        border: '1px solid rgba(80, 220, 145, 0.55)',
                        color: '#7df0b0',
                      }}
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>{tr('Chat Store Cashier', 'Chat Kasir Toko')}</span>
                    </a>
                  )}
                </div>

                {onReorder && orderItems.length > 0 && (
                  <button
                    type="button"
                    onClick={handleReorderClick}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl font-extrabold text-xs transition cursor-pointer"
                    style={{
                      background: 'linear-gradient(100deg, #e5b13a 0%, #fbdc7a 50%, #e8b440 100%)',
                      color: '#1b1204',
                      boxShadow: '0 0 16px rgba(255, 185, 45, 0.35)',
                    }}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{tr('Reorder These Items', 'Pesan Ulang Barang Ini')}</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-12 text-xs" style={{ color: '#b7ad99' }}>
              {tr(
                'Select an order from the list on the left to inspect fulfillment status in real-time.',
                'Pilih salah satu pesanan dari daftar di sebelah kiri untuk melihat status pemenuhan barang secara langsung.'
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
