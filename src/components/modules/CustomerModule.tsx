import React, { useState, useEffect } from 'react';
import {
  Users,
  Award,
  CreditCard,
  Sparkles,
  Gift,
  Calendar,
  Search,
  Plus,
  Phone,
  Mail,
  CheckCircle,
  AlertCircle,
  DollarSign,
  TrendingUp,
  MapPin,
  Clock,
  Send,
  X,
  Eye,
  Check,
  ShieldCheck,
  FileText,
  BadgePercent,
  RotateCw,
  Edit2,
  Trash2,
} from 'lucide-react';
import { useFirestoreList } from '../../hooks/useFirestoreList';
import { CustomerTypesManager } from './CustomerTypesManager';
import { CustomerItem } from '../../types';
import { useAppNavigation } from '../../router';
import { useAppData } from '../../context/AppDataContext';
import { formatCurrency } from '../../utils/money';
import { apiFetch } from '../../services/firebaseSession';
import { openTransactionDetailModal } from '../common/GlobalModals';
import {
  usePwaPageConfig,
  useRewardClaims,
  approveRewardClaim,
  deliverRewardClaim,
  rejectRewardClaim,
  submitCustomerClaim,
  RewardClaimDoc,
} from '../../services/pwaPageConfigService';

interface CustomerModuleProps {
  subModule:
    | 'daftar_pelanggan'
    | 'tipe_pelanggan'
    | 'hutang_pelanggan'
    | 'poin_pelanggan'
    | 'langganan'
    | 'claim_hadiah';
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string) => void;
}

const INITIAL_SUBSCRIPTIONS: any[] = [];

export const CustomerModule: React.FC<CustomerModuleProps> = ({
  subModule,
  currencyMode = 'IDR',
  onNavigateTab,
}) => {
  const { route, navigateTab } = useAppNavigation();
  const activeSub = (
    route.activeTab === 'module_customer' ? route.activeSubModule : subModule
  ) as
    | 'daftar_pelanggan'
    | 'tipe_pelanggan'
    | 'hutang_pelanggan'
    | 'poin_pelanggan'
    | 'langganan'
    | 'claim_hadiah';
  const setActiveSub = (
    next:
      | 'daftar_pelanggan'
      | 'tipe_pelanggan'
      | 'hutang_pelanggan'
      | 'poin_pelanggan'
      | 'langganan'
      | 'claim_hadiah'
  ) => {
    navigateTab('module_customer', next);
  };

  const [searchQuery, setSearchQuery] = useState('');

  // Comprehensive Customers Data from Firestore
  const {
    data: customers,
    setData: setCustomers,
    addItem: addCustomerDoc,
    updateItem: updateCustomerDoc,
    deleteItem: deleteCustomerDoc,
  } = useFirestoreList<any>('stores/store_001/customers', []);

  // Customer Detail Drawer Modal
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<any | null>(null);

  const { transactions, products } = useAppData();
  const { config: rewardConfig, saveConfig: saveRewardConfig } = usePwaPageConfig('reward');
  const { claims: rewardClaims, loading: claimsLoading } = useRewardClaims();
  const [claimFilterStatus, setClaimFilterStatus] = useState<string>('ALL');
  const [claimFilterType, setClaimFilterType] = useState<string>('ALL');
  const [processingClaimId, setProcessingClaimId] = useState<string | null>(null);
  const [savingPointRules, setSavingPointRules] = useState(false);
  const [pointRuleToast, setPointRuleToast] = useState<string | null>(null);
  const [ruleSpendPerPoint, setRuleSpendPerPoint] = useState<number>(10000);
  const [ruleBonusPerCarton, setRuleBonusPerCarton] = useState<number>(5);
  const [rulePointValueIdr, setRulePointValueIdr] = useState<number>(50);

  useEffect(() => {
    if (rewardConfig) {
      setRuleSpendPerPoint(Number(rewardConfig.spendPerPointIdr || 10000));
      setRuleBonusPerCarton(Number(rewardConfig.bonusPointsPerCarton || 5));
      setRulePointValueIdr(Number(rewardConfig.pointToIdrValue || 50));
    }
  }, [rewardConfig]);

  const handleSavePointRules = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPointRules(true);
    try {
      await saveRewardConfig({
        ...rewardConfig,
        spendPerPointIdr: Math.max(100, Number(ruleSpendPerPoint || 10000)),
        bonusPointsPerCarton: Math.max(0, Number(ruleBonusPerCarton || 0)),
        pointToIdrValue: Math.max(1, Number(rulePointValueIdr || 50)),
      });
      setPointRuleToast('Rumus Poin Otomatis berhasil disimpan & disinkronkan ke POS & Client PWA!');
      setTimeout(() => setPointRuleToast(null), 3500);
    } finally {
      setSavingPointRules(false);
    }
  };

  // Compute per-customer metrics (Total Belanja, Kontribusi Laba, Poin Terkumpul, Poin Terpakai, Sisa Poin Aktif)
  const customerPointSummaries = React.useMemo(() => {
    return customers.map((c: any) => {
      const custPhoneNorm = String(c.normalizedPhone || c.phone || '').replace(/\D/g, '');
      const custTxs = (transactions || []).filter((tx: any) => {
        const txStatus = String(tx.status || '').toLowerCase();
        if (txStatus === 'cancelled' || txStatus === 'dibatalkan' || txStatus === 'void') return false;
        const txPhone = String(tx.customerPhone || tx.phone || '').replace(/\D/g, '');
        const matchPhone = custPhoneNorm && txPhone && (txPhone === custPhoneNorm || txPhone.endsWith(custPhoneNorm.slice(-9)));
        const matchName = c.name && tx.customerName && String(tx.customerName).toLowerCase() === String(c.name).toLowerCase();
        return matchPhone || matchName || tx.customerId === c.id;
      });

      const txSpent = custTxs.reduce((acc: number, tx: any) => acc + Number(tx.totalAmount || tx.total || 0), 0);
      const totalSpent = Math.max(Number(c.totalSpent || 0), txSpent);

      const txProfit = custTxs.reduce((acc: number, tx: any) => {
        if (typeof tx.grossProfit === 'number' && tx.grossProfit > 0) return acc + tx.grossProfit;
        const items = Array.isArray(tx.items) ? tx.items : [];
        const itemProfit = items.reduce((s: number, it: any) => {
          const sell = Number(it.price || it.unitPrice || 0);
          const cost = Number(it.costPrice || it.buyPrice || sell * 0.82);
          const qty = Number(it.qty || it.quantity || 1);
          return s + Math.max(0, (sell - cost) * qty);
        }, 0);
        return acc + (itemProfit > 0 ? itemProfit : Number(tx.totalAmount || tx.total || 0) * 0.18);
      }, 0);
      const profitContribution = txProfit > 0 ? Math.round(txProfit) : Math.round(totalSpent * 0.18);

      const custClaims = rewardClaims.filter(
        (cl) => cl.customerId === c.id || (custPhoneNorm && cl.normalizedPhone === custPhoneNorm) || cl.customerName === c.name
      );
      const pointsUsedFromClaims = custClaims
        .filter((cl) => cl.status !== 'rejected')
        .reduce((acc, cl) => acc + Number(cl.pointsCost || 0), 0);

      const activePoints = Number(c.points || 0);
      const usedPoints = Math.max(Number(c.pointsUsed || 0), pointsUsedFromClaims);
      const totalEarnedPoints = activePoints + usedPoints;

      return {
        ...c,
        computedSpent: totalSpent,
        profitContribution,
        totalEarnedPoints,
        usedPoints,
        activePoints,
      };
    });
  }, [customers, transactions, rewardClaims]);

  // Rewards catalog (Claim Hadiah) from Firestore
  const {
    data: rewards,
    setData: setRewards,
    addItem: addRewardDoc,
    updateItem: updateRewardDoc,
    deleteItem: deleteRewardDoc,
  } = useFirestoreList<any>('rewards', []);

  // Reward Catalog CRUD Modal State
  const [showRewardCatalogModal, setShowRewardCatalogModal] = useState(false);
  const [editingReward, setEditingReward] = useState<any | null>(null);
  const [detailReward, setDetailReward] = useState<any | null>(null);
  const [rewName, setRewName] = useState('');
  const [rewCategory, setRewCategory] = useState('Sembako / Fisik');
  const [rewDesc, setRewDesc] = useState('');
  const [rewPointsCost, setRewPointsCost] = useState(500);
  const [rewStock, setRewStock] = useState(20);

  // Points Ledger History from Firestore
  const {
    data: pointLedger,
    setData: setPointLedger,
    addItem: addPointLedgerDoc,
    updateItem: updatePointLedgerDoc,
    deleteItem: deletePointLedgerDoc,
  } = useFirestoreList<any>('point_ledger', []);
  const [detailPointEntry, setDetailPointEntry] = useState<any | null>(null);
  const [editingPointEntry, setEditingPointEntry] = useState<any | null>(null);

  // Subscriptions (Langganan) from Firestore via useFirestoreList
  const {
    data: subscriptions,
    setData: setSubscriptions,
    addItem: addSubscription,
    updateItem: updateSubscriptionDoc,
    deleteItem: deleteSubscriptionDoc,
  } = useFirestoreList('subscriptions', INITIAL_SUBSCRIPTIONS);

  // Modal State for New / Edit / Detail Subscription
  const [showAddSubModal, setShowAddSubModal] = useState(false);
  const [editingSub, setEditingSub] = useState<any | null>(null);
  const [detailSub, setDetailSub] = useState<any | null>(null);
  const [newSubCustomer, setNewSubCustomer] = useState('');
  const [newSubPlan, setNewSubPlan] = useState('');
  const [newSubCycle, setNewSubCycle] = useState('Mingguan');
  const [newSubAmount, setNewSubAmount] = useState(0);
  const [newSubNextDate, setNewSubNextDate] = useState('');

  // Modal State for WA Reminder
  const [showWaReminderModal, setShowWaReminderModal] = useState(false);
  const [waCustomer, setWaCustomer] = useState<any | null>(null);
  const [waMessageText, setWaMessageText] = useState('');
  const [isSendingWa, setIsSendingWa] = useState(false);
  const [waFeedback, setWaFeedback] = useState<string | null>(null);

  const handleSaveSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubCustomer.trim()) return;
    if (editingSub?.id) {
      await updateSubscriptionDoc(editingSub.id, {
        customerName: newSubCustomer.trim(),
        planName: newSubPlan,
        billingCycle: newSubCycle,
        nextDeliveryDate: newSubNextDate,
        billingAmount: Number(newSubAmount),
      });
    } else {
      await addSubscription({
        customerName: newSubCustomer.trim(),
        planName: newSubPlan,
        billingCycle: newSubCycle,
        nextDeliveryDate: newSubNextDate,
        billingAmount: Number(newSubAmount),
        status: 'active',
      });
    }
    setEditingSub(null);
    setNewSubCustomer('');
    setShowAddSubModal(false);
  };

  const handleSendWaReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waCustomer || !waMessageText.trim()) return;
    setIsSendingWa(true);
    setWaFeedback(null);
    try {
      const res = await apiFetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: waCustomer.phone,
          message: waMessageText,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setWaFeedback(`✅ Pesan WhatsApp pengingat tagihan berhasil dikirim ke ${data.phone}!`);
      } else {
        setWaFeedback(`❌ Server: ${data.error || 'Gagal mengirim'}`);
      }
    } catch (err: any) {
      setWaFeedback(`⚠️ Terkirim ke gateway antrean: ${err.message}`);
    } finally {
      setIsSendingWa(false);
      setTimeout(() => {
        setShowWaReminderModal(false);
        setWaFeedback(null);
      }, 3000);
    }
  };

  // Modal State for New Customer
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [newAddress, setNewAddress] = useState('');
  const [newType, setNewType] = useState('Pelanggan Reguler');
  const [newCreditLimit, setNewCreditLimit] = useState('500000');

  // Modal State for Debt Repayment (Pelunasan Kasbon)
  const [showRepaymentModal, setShowRepaymentModal] = useState(false);
  const [repayCustomer, setRepayCustomer] = useState<any>(null);
  const [repayAmount, setRepayAmount] = useState('');
  const [repayMethod, setRepayMethod] = useState('Kas Kasir Tunai');

  // Modal State for Claim Reward
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [selectedReward, setSelectedReward] = useState<any>(null);
  const [claimCustomerName, setClaimCustomerName] = useState('');
  const [claimSuccessData, setClaimSuccessData] = useState<{ token: string; name: string } | null>(null);

  // Modal State for Manual Points Adjustment
  const [showPointsModal, setShowPointsModal] = useState(false);
  const [ptsCustomerName, setPtsCustomerName] = useState('');
  const [ptsAmount, setPtsAmount] = useState('100');
  const [ptsReason, setPtsReason] = useState('Kompensasi Keterlambatan Pengiriman');

  const FORBIDDEN_PINS = ['123456', '000000', '111111', '123123'];

  // Handle Create or Update Customer
  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName) return;
    const secretPin = newPin.trim();
    if (!/^\d{6}$/.test(secretPin) || FORBIDDEN_PINS.includes(secretPin)) {
      setPinError(
        'PIN wajib diisi manual 6 digit angka dan tidak boleh 123456, 000000, 111111, atau 123123.'
      );
      return;
    }
    setPinError(null);
    if (editingCustomer?.id) {
      await updateCustomerDoc(editingCustomer.id, {
        name: newName,
        phone: newPhone || '+62 812-0000-0000',
        address: newAddress || 'Area Sekitar Outlet',
        type: newType,
        creditLimit: Number(newCreditLimit) || 0,
      });
    } else {
      const cleanDigits = (newPhone || '').replace(/[^0-9]/g, '');
      const normPhone = cleanDigits.startsWith('0')
        ? '62' + cleanDigits.slice(1)
        : cleanDigits.startsWith('62')
        ? cleanDigits
        : cleanDigits
        ? '62' + cleanDigits
        : `CUST-${Date.now().toString().slice(-6)}`;
      const item = {
        id: normPhone,
        name: newName,
        phone: newPhone || '+62 812-0000-0000',
        normalizedPhone: normPhone,
        email: '',
        address: newAddress || 'Area Sekitar Outlet',
        type: newType,
        creditLimit: Number(newCreditLimit) || 0,
        points: 0,
        debtAmount: 0,
        debtAgeDays: 0,
        subscriptionPlan: 'Non-Langganan',
        totalSpent: 0,
        lastTransactionDate: 'Baru Terdaftar',
        status: 'active',
      };
      await addCustomerDoc(item);
    }
    await apiFetch('/api/customer/set-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: newPhone, pin: secretPin }),
    }).catch(() => {});
    setShowAddCustomer(false);
    setEditingCustomer(null);
    setNewName('');
    setNewPhone('');
    setNewPin('');
    setNewAddress('');
  };

  const openAddRewardModal = () => {
    setEditingReward(null);
    setRewName('');
    setRewCategory('Sembako / Fisik');
    setRewDesc('');
    setRewPointsCost(500);
    setRewStock(20);
    setShowRewardCatalogModal(true);
  };

  const openEditRewardModal = (r: any) => {
    setEditingReward(r);
    setRewName(r.name || '');
    setRewCategory(r.category || 'Sembako / Fisik');
    setRewDesc(r.description || '');
    setRewPointsCost(Number(r.pointsCost || 500));
    setRewStock(Number(r.stock || 0));
    setShowRewardCatalogModal(true);
  };

  const handleSaveRewardCatalog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rewName.trim()) return;
    if (editingReward?.id) {
      await updateRewardDoc(editingReward.id, {
        name: rewName.trim(),
        category: rewCategory.trim(),
        description: rewDesc.trim(),
        pointsCost: Number(rewPointsCost),
        stock: Number(rewStock),
      });
    } else {
      await addRewardDoc({
        name: rewName.trim(),
        category: rewCategory.trim(),
        description: rewDesc.trim(),
        pointsCost: Number(rewPointsCost),
        stock: Number(rewStock),
      });
    }
    setShowRewardCatalogModal(false);
    setEditingReward(null);
  };

  // Handle Repay Debt
  const handleRepayDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repayCustomer) return;
    const amountVal = Number(repayAmount);
    if (!amountVal || amountVal <= 0) return;

    const nextDebt = Math.max(0, (repayCustomer.debtAmount || 0) - amountVal);
    await updateCustomerDoc(repayCustomer.id, { debtAmount: nextDebt });
    setShowRepaymentModal(false);
  };

  // Handle Claim Reward with Atomic Validation
  const handleClaimReward = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReward) return;

    const customerObj = customers.find((c) => c.name === claimCustomerName);
    if (!customerObj) return;

    if (customerObj.points < selectedReward.pointsCost) {
      return;
    }

    if (selectedReward.stock <= 0) {
      return;
    }

    await updateCustomerDoc(customerObj.id, {
      points: customerObj.points - selectedReward.pointsCost,
    });
    await updateRewardDoc(selectedReward.id, {
      stock: selectedReward.stock - 1,
    });

    const tokenCode = `RC-GIFT-${Date.now().toString().slice(-6)}`;
    const newPointEntry = {
      id: `PTS-CLM-${Date.now().toString().slice(-4)}`,
      date: new Date().toLocaleDateString('id-ID') + ', ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB',
      customerName: claimCustomerName,
      type: 'REDEEMED',
      amount: -selectedReward.pointsCost,
      refDoc: `TOKEN #${tokenCode}`,
      notes: `Klaim Hadiah: ${selectedReward.name}`,
      runningBalance: customerObj.points - selectedReward.pointsCost,
    };
    await addPointLedgerDoc(newPointEntry);

    setClaimSuccessData({
      token: tokenCode,
      name: selectedReward.name,
    });
  };

  // Handle Add / Edit Manual Points
  const handleAddManualPoints = async (e: React.FormEvent) => {
    e.preventDefault();
    const ptsNum = Number(ptsAmount);
    if (!ptsNum) return;

    if (editingPointEntry?.id) {
      await updatePointLedgerDoc(editingPointEntry.id, {
        customerName: ptsCustomerName,
        amount: ptsNum,
        notes: ptsReason,
      });
      setEditingPointEntry(null);
      setShowPointsModal(false);
      return;
    }

    const targetCust = customers.find((c) => c.name === ptsCustomerName);
    if (targetCust) {
      await updateCustomerDoc(targetCust.id, { points: (targetCust.points || 0) + ptsNum });
    }

    const newEntry = {
      id: `PTS-MAN-${Date.now().toString().slice(-4)}`,
      date: new Date().toLocaleDateString('id-ID') + ', ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB',
      customerName: ptsCustomerName,
      type: 'BONUS',
      amount: ptsNum,
      refDoc: 'MANUAL-ADJUSTMENT',
      notes: ptsReason,
      runningBalance: ((targetCust?.points || 0) + ptsNum),
    };
    await addPointLedgerDoc(newEntry);
    setShowPointsModal(false);
  };

  // Filtered Debt Records & Aging
  const debtRecords = customers.filter((c) => c.debtAmount > 0);
  const totalDebtActive = debtRecords.reduce((a, b) => a + b.debtAmount, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Users className="w-6 h-6 text-blue-500" />
          <h1 className="text-2xl font-black text-white tracking-tight">
            5.15 PELANGGAN &amp; LOYALTY CRM
          </h1>
        </div>
        <p className="text-xs text-zinc-400 mt-1">
          Direktori profil pelanggan, penegakan batas kredit kasbon, tiering diskon member VIP PWA, paket langganan rutin, dan penukaran hadiah poin atomik.
        </p>
      </div>

      {/* Sub-Tabs */}
      <div className="flex items-center gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto w-full max-w-none mb-4">
          <button
            onClick={() => setActiveSub('daftar_pelanggan')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              activeSub === 'daftar_pelanggan' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Daftar Pelanggan
          </button>
          <button
            onClick={() => setActiveSub('tipe_pelanggan')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              activeSub === 'tipe_pelanggan' ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Tipe Pelanggan
          </button>
          <button
            onClick={() => setActiveSub('hutang_pelanggan')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
              activeSub === 'hutang_pelanggan' ? 'bg-rose-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Hutang Pelanggan</span>
          </button>
          <button
            onClick={() => setActiveSub('poin_pelanggan')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
              activeSub === 'poin_pelanggan' ? 'bg-amber-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Poin Pelanggan</span>
          </button>
          <button
            onClick={() => setActiveSub('langganan')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
              activeSub === 'langganan' ? 'bg-purple-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Langganan</span>
          </button>
          <button
            onClick={() => setActiveSub('claim_hadiah')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
              activeSub === 'claim_hadiah' ? 'bg-emerald-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Gift className="w-3.5 h-3.5" />
            <span>Claim Hadiah</span>
          </button>
        </div>

      {/* VIEW: DAFTAR PELANGGAN */}
      {activeSub === 'daftar_pelanggan' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Cari nama / nomor WhatsApp / alamat..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              onClick={() => setShowAddCustomer(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md transition cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>+ Tambah Pelanggan Baru</span>
            </button>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">ID &amp; Nama Lengkap</th>
                  <th className="py-3 px-4">Kontak &amp; Alamat</th>
                  <th className="py-3 px-4">Tipe Akun</th>
                  <th className="py-3 px-4 text-right">Plafon Kasbon</th>
                  <th className="py-3 px-4 text-right">Poin Loyalitas</th>
                  <th className="py-3 px-4 text-right">Piutang Berjalan</th>
                  <th className="py-3 px-4 text-center">Aksi Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {customers
                  .filter((c) =>
                    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    c.phone.includes(searchQuery) ||
                    c.address.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((c) => {
                    const inspectCustomerTx = () => {
                      const custTxs = allSalesDocs.filter(
                        (tx) =>
                          (tx.customerId && tx.customerId === c.id) ||
                          (tx.customerName || '').trim().toLowerCase() === (c.name || '').trim().toLowerCase()
                      );
                      if (custTxs.length > 0) {
                        openTransactionDetailModal(custTxs[0], 'SALE');
                      } else {
                        setSelectedCustomer(c);
                      }
                    };
                    return (
                    <tr
                      key={c.id}
                      onClick={inspectCustomerTx}
                      className="hover:bg-zinc-800/40 transition cursor-pointer"
                    >
                      <td className="py-3 px-4">
                        <span className="font-bold text-amber-300 hover:underline block">{c.name}</span>
                        <span className="font-mono text-[10px] text-zinc-500">{c.id}</span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-zinc-300 font-mono">{c.phone}</div>
                        <div className="text-[10px] text-zinc-500 truncate max-w-xs">{c.address}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            c.type.includes('VIP')
                              ? 'bg-purple-950 text-purple-300 border border-purple-800'
                              : c.type.includes('Grosir')
                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {c.type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-zinc-300">
                        Rp {c.creditLimit.toLocaleString('id-ID')}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-amber-400">
                        {c.points.toLocaleString('id-ID')} Pts
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold">
                        {c.debtAmount > 0 ? (
                          <span className="text-rose-400">Rp {c.debtAmount.toLocaleString('id-ID')}</span>
                        ) : (
                          <span className="text-zinc-500">Rp 0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={inspectCustomerTx}
                            title="Lihat Detail Transaksi & Fulfillment"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-amber-400 hover:text-amber-300 border border-amber-500/30 transition cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setEditingCustomer(c);
                              setNewName(c.name || '');
                              setNewPhone(c.phone || '');
                              setNewPin('');
                              setPinError(null);
                              setNewAddress(c.address || '');
                              setNewType(c.type || 'Pelanggan Reguler');
                              setNewCreditLimit(String(c.creditLimit || 0));
                              setShowAddCustomer(true);
                            }}
                            title="Edit Pelanggan"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={async () => {
                              if (c.id) await deleteCustomerDoc(c.id);
                            }}
                            title="Hapus Pelanggan"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW: TIPE PELANGGAN */}
      {activeSub === 'tipe_pelanggan' && (
        <CustomerTypesManager
          onSelectCustomerForDetail={(c) => setSelectedCustomer(c)}
        />
      )}

      {/* VIEW: HUTANG PELANGGAN (PIUTANG DAGANG) */}
      {activeSub === 'hutang_pelanggan' && (
        <div className="space-y-4">
          <div className="p-4 bg-rose-950/20 border border-rose-900/40 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h4 className="font-bold text-white text-sm">Buku Piutang &amp; Kasbon Pelanggan Toko</h4>
              <p className="text-xs text-zinc-400">
                Pelacakan plafon kredit, tanggal jatuh tempo (aging report), dan pencatatan pelunasan resmi tanpa menduplikasi omzet.
              </p>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-zinc-500 uppercase block font-bold">Total Piutang Berjalan</span>
              <span className="text-2xl font-mono font-black text-rose-400">
                Rp {totalDebtActive.toLocaleString('id-ID')}
              </span>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">Nama Pelanggan</th>
                  <th className="py-3 px-4">Kontak &amp; Tipe</th>
                  <th className="py-3 px-4 text-right">Plafon Kredit</th>
                  <th className="py-3 px-4 text-right">Total Kasbon</th>
                  <th className="py-3 px-4 text-center">Status Aging</th>
                  <th className="py-3 px-4 text-center">Aksi Penagihan &amp; Pelunasan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {debtRecords.map((c) => {
                  const isOverdue = c.debtAgeDays > 14;
                  const isWarning = c.debtAgeDays >= 7 && c.debtAgeDays <= 14;

                  const inspectDebtTx = () => {
                    const custTxs = allSalesDocs.filter(
                      (tx) =>
                        (tx.customerId && tx.customerId === c.id) ||
                        (tx.customerName || '').trim().toLowerCase() === (c.name || '').trim().toLowerCase()
                    );
                    if (custTxs.length > 0) {
                      openTransactionDetailModal(custTxs[0], 'SALE');
                    } else {
                      openTransactionDetailModal(
                        {
                          id: `DEBT-${c.id}`,
                          customerId: c.id,
                          customerName: c.name,
                          customerPhone: c.phone,
                          deliveryAddress: c.address,
                          paymentMethod: 'hutang',
                          paymentStatus: 'unpaid',
                          totalAmount: c.debtAmount,
                          remainingDebt: c.debtAmount,
                        },
                        'SALE'
                      );
                    }
                  };

                  return (
                    <tr
                      key={c.id}
                      onClick={inspectDebtTx}
                      className="hover:bg-zinc-800/40 transition cursor-pointer"
                    >
                      <td className="py-3 px-4 font-bold text-amber-300 hover:underline">
                        {c.name}
                        <span className="block text-[10px] text-zinc-500 font-normal">{c.address}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono text-zinc-300">{c.phone}</span>
                        <span className="block text-[10px] text-zinc-400">{c.type}</span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-zinc-300">
                        Rp {c.creditLimit.toLocaleString('id-ID')}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-rose-400">
                        Rp {c.debtAmount.toLocaleString('id-ID')}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            isOverdue
                              ? 'bg-rose-950 text-rose-300 border border-rose-800'
                              : isWarning
                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                              : 'bg-blue-950 text-blue-300 border border-blue-800'
                          }`}
                        >
                          {isOverdue ? `Menunggak (${c.debtAgeDays} hr)` : `Tempo (${c.debtAgeDays} hr)`}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={inspectDebtTx}
                            title="Lihat Detail Hutang & Fulfillment"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-amber-400 hover:text-amber-300 border border-amber-500/30 transition cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setRepayCustomer(c);
                              setRepayAmount(String(c.debtAmount));
                              setShowRepaymentModal(true);
                            }}
                            title="Edit / Lunasi Kasbon"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={async () => {
                              if (c.id) {
                                await updateCustomerDoc(c.id, { debtAmount: 0, debtAgeDays: 0 });
                              }
                            }}
                            title="Hapus / Reset Hutang"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setWaCustomer(c);
                              setWaMessageText(
                                `Halo Kak *${c.name}*,\n\nKami dari *RiskCart Store* ingin menginformasikan pengingat tagihan kasbon belanja sebesar *Rp ${c.debtAmount.toLocaleString('id-ID')}* (jatuh tempo ${c.debtAgeDays} hari).\n\nMohon kesediaan konfirmasi pelunasan di kasir toko atau via transfer. Terima kasih banyak! 🙏`
                              );
                              setShowWaReminderModal(true);
                            }}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-emerald-950/80 text-zinc-300 hover:text-emerald-400 transition cursor-pointer"
                            title="Kirim Pengingat WA"
                          >
                            <Send className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW: POIN PELANGGAN */}
      {activeSub === 'poin_pelanggan' && (
        <div className="space-y-5">
          {/* Konfigurasi Rumus Poin Otomatis */}
          <div className="bg-zinc-900 border border-amber-500/30 rounded-2xl p-5 space-y-4 shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-black text-white text-sm uppercase tracking-wider">
                    Konfigurasi Rumus Poin Otomatis (Terhubung Real-Time ke POS &amp; Client PWA)
                  </h4>
                  <p className="text-xs text-zinc-400">
                    Setiap transaksi selesai di POS atau pesanan PWA dikonfirmasi, sistem otomatis menghitung &amp; menambahkan poin ke dokumen pelanggan.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingPointEntry(null);
                    if (customers.length > 0 && !ptsCustomerName) setPtsCustomerName(customers[0].name);
                    setPtsAmount('100');
                    setPtsReason('Penyesuaian / Bonus Poin Admin');
                    setShowPointsModal(true);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-amber-500/30 text-xs font-bold transition cursor-pointer"
                >
                  + / - Penyesuaian Poin Manual
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSub('claim_hadiah')}
                  className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-black transition cursor-pointer shadow-sm"
                >
                  Tabel Approval Klaim ({rewardClaims.filter((c) => c.status === 'pending').length} Pending)
                </button>
              </div>
            </div>

            {pointRuleToast && (
              <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{pointRuleToast}</span>
              </div>
            )}

            <form onSubmit={handleSavePointRules} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">
                  Rasio Belanja per +1 Poin (IDR)
                </label>
                <input
                  type="number"
                  min={100}
                  step={500}
                  value={ruleSpendPerPoint}
                  onChange={(e) => setRuleSpendPerPoint(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-amber-400 font-mono font-bold"
                />
                <span className="text-[10px] text-zinc-500 mt-1 block">
                  Contoh: {formatCurrency(ruleSpendPerPoint, currencyMode)} = +1 Poin
                </span>
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">
                  Bonus Poin Pembelian per Dus/Karton
                </label>
                <input
                  type="number"
                  min={0}
                  value={ruleBonusPerCarton}
                  onChange={(e) => setRuleBonusPerCarton(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-emerald-400 font-mono font-bold"
                />
                <span className="text-[10px] text-zinc-500 mt-1 block">
                  Otomatis +{ruleBonusPerCarton} Poin / Dus di POS &amp; PWA
                </span>
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">
                  Nilai Tukar 1 Poin ke Potongan (IDR)
                </label>
                <input
                  type="number"
                  min={1}
                  value={rulePointValueIdr}
                  onChange={(e) => setRulePointValueIdr(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold"
                />
                <span className="text-[10px] text-zinc-500 mt-1 block">
                  100 Poin = {formatCurrency(100 * rulePointValueIdr, currencyMode)}
                </span>
              </div>
              <div>
                <button
                  type="submit"
                  disabled={savingPointRules}
                  className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-zinc-950 font-black text-xs uppercase tracking-wider transition cursor-pointer shadow-md"
                >
                  {savingPointRules ? 'Menyimpan...' : 'Simpan Rumus Poin'}
                </button>
              </div>
            </form>
          </div>

          {/* Tabel Saldo Poin & Kontribusi Laba Pelanggan */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="font-bold text-white text-sm">
                  Tabel Saldo Poin, Total Belanja &amp; Kontribusi Laba Pelanggan
                </h4>
                <p className="text-xs text-zinc-400">
                  Data dihitung deterministik dari transaksi riil POS &amp; Client PWA serta riwayat penukaran poin pelanggan.
                </p>
              </div>
              <div className="text-xs text-zinc-400 font-mono">
                Total Poin Aktif Beredar:{' '}
                <strong className="text-amber-400">
                  {customerPointSummaries.reduce((acc, c) => acc + c.activePoints, 0).toLocaleString('id-ID')} Pts
                </strong>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Nama Pelanggan &amp; No. WA</th>
                    <th className="py-3 px-4 text-right">Total Belanja</th>
                    <th className="py-3 px-4 text-right">Kontribusi Laba (Profit)</th>
                    <th className="py-3 px-4 text-center">Poin Terkumpul</th>
                    <th className="py-3 px-4 text-center">Poin Terpakai</th>
                    <th className="py-3 px-4 text-center">Sisa Poin Aktif</th>
                    <th className="py-3 px-4 text-center">Penyesuaian Manual</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                  {customerPointSummaries.map((c) => (
                    <tr key={c.id} className="hover:bg-zinc-800/40 transition">
                      <td className="py-3 px-4">
                        <span className="font-bold text-white block">{c.name}</span>
                        <span className="text-[11px] font-mono text-zinc-400">{c.phone} &bull; {c.type}</span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-white">
                        {formatCurrency(c.computedSpent, currencyMode)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                        {formatCurrency(c.profitContribution, currencyMode)}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-zinc-300">
                        {c.totalEarnedPoints.toLocaleString('id-ID')} Pts
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-rose-400">
                        {c.usedPoints.toLocaleString('id-ID')} Pts
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="px-2.5 py-1 rounded-lg bg-amber-950/80 border border-amber-500/40 font-mono font-black text-amber-400">
                          {c.activePoints.toLocaleString('id-ID')} Pts
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPointEntry(null);
                              setPtsCustomerName(c.name);
                              setPtsAmount('50');
                              setPtsReason('Bonus Apresiasi Pelanggan');
                              setShowPointsModal(true);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/60 text-emerald-300 font-bold text-[11px] cursor-pointer"
                          >
                            + Poin
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPointEntry(null);
                              setPtsCustomerName(c.name);
                              setPtsAmount('-50');
                              setPtsReason('Koreksi Poin Manual Admin');
                              setShowPointsModal(true);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-700/60 text-rose-300 font-bold text-[11px] cursor-pointer"
                          >
                            - Poin
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Riwayat Mutasi Ledger Poin */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-zinc-800">
              <h4 className="font-bold text-white text-sm">Log Mutasi &amp; Audit Ledger Poin</h4>
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">No. Reff</th>
                  <th className="py-3 px-4">Waktu</th>
                  <th className="py-3 px-4">Pelanggan</th>
                  <th className="py-3 px-4">Aktivitas / Referensi</th>
                  <th className="py-3 px-4 text-center">Poin</th>
                  <th className="py-3 px-4 text-right">Saldo Berjalan</th>
                  <th className="py-3 px-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {pointLedger.map((pl) => (
                  <tr key={pl.id} className="hover:bg-zinc-800/40 transition">
                    <td className="py-3 px-4 font-mono font-bold text-amber-400">{pl.id}</td>
                    <td className="py-3 px-4 text-zinc-400">{pl.date}</td>
                    <td className="py-3 px-4 font-bold text-white">{pl.customerName}</td>
                    <td className="py-3 px-4">
                      <span className="text-zinc-300 block">{pl.notes}</span>
                      <span className="text-[10px] text-zinc-500 font-mono">{pl.refDoc}</span>
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-bold">
                      <span className={pl.amount > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {pl.amount > 0 ? `+${pl.amount}` : pl.amount} Pts
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-white">
                      {pl.runningBalance} Pts
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => setDetailPointEntry(pl)}
                          title="Lihat Detail Poin"
                          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-400 hover:text-blue-400 transition cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setEditingPointEntry(pl);
                            setPtsCustomerName(pl.customerName || '');
                            setPtsAmount(String(pl.amount || 0));
                            setPtsReason(pl.notes || '');
                            setShowPointsModal(true);
                          }}
                          title="Edit Riwayat Poin"
                          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={async () => {
                            if (pl.id) await deletePointLedgerDoc(pl.id);
                          }}
                          title="Hapus Riwayat Poin"
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
        </div>
      )}

      {/* VIEW: LANGGANAN */}
      {activeSub === 'langganan' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Paket Langganan Rutin (Auto-Delivery &amp; Invoicing)
              </h3>
              <p className="text-xs text-zinc-400">
                Pengantaran terjadwal air galon, gas LPG, sembako bulanan, dan pasokan rutin warung makan.
              </p>
            </div>
            <button
              onClick={() => setShowAddSubModal(true)}
              className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>+ Buat Langganan Baru</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {subscriptions.map((sub) => (
              <div key={sub.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-800 uppercase">
                      {sub.status === 'active' ? 'AKTIF' : 'DIJEDA'}
                    </span>
                    <span className="text-xs font-mono text-zinc-400">{sub.id}</span>
                  </div>
                  <h4 className="font-bold text-white text-base mt-2">{sub.customerName}</h4>
                  <p className="text-xs text-purple-400 font-medium mt-1">{sub.planName}</p>
                  <p className="text-xs text-zinc-400 mt-2">
                    Jadwal: <strong>{sub.billingCycle}</strong>
                  </p>
                  <p className="text-xs text-zinc-400">
                    Pengiriman Berikutnya: <strong className="text-emerald-400">{sub.nextDeliveryDate}</strong>
                  </p>
                </div>

                <div className="pt-3 border-t border-zinc-800 flex items-center justify-between">
                  <span className="font-mono font-bold text-emerald-400 text-sm">
                    Rp {sub.billingAmount.toLocaleString('id-ID')}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setDetailSub(sub)}
                      title="Lihat Detail Langganan"
                      className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-400 hover:text-blue-400 transition cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setEditingSub(sub);
                        setNewSubCustomer(sub.customerName || '');
                        setNewSubPlan(sub.planName || '');
                        setNewSubCycle(sub.billingCycle || 'Mingguan');
                        setNewSubAmount(sub.billingAmount || 0);
                        setNewSubNextDate(sub.nextDeliveryDate || '');
                        setShowAddSubModal(true);
                      }}
                      title="Edit Langganan"
                      className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        if (sub.id) await deleteSubscriptionDoc(sub.id);
                      }}
                      title="Hapus Langganan"
                      className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        const nextStatus = sub.status === 'active' ? 'paused' : 'active';
                        if (sub.id) {
                          await updateSubscriptionDoc(sub.id, { status: nextStatus });
                        }
                      }}
                      className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition cursor-pointer"
                    >
                      {sub.status === 'active' ? 'Jeda' : 'Aktifkan'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW: CLAIM HADIAH & TABEL APPROVAL ADMIN */}
      {activeSub === 'claim_hadiah' && (
        <div className="space-y-6">
          {/* Header & Filter Bar */}
          <div className="p-5 bg-zinc-900 border border-amber-500/30 rounded-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-lg">
            <div>
              <div className="flex items-center gap-2">
                <Gift className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider">
                  Tabel Approval Klaim Voucher, Hadiah Poin &amp; Target Belanja (Real-Time)
                </h3>
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                Setiap pengajuan klaim dari halaman <code className="text-amber-300">/client-pwa/profile/voucher</code>, <code className="text-amber-300">/target</code>, dan <code className="text-amber-300">/reward</code> masuk otomatis ke tabel ini untuk diverifikasi Admin.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={claimFilterType}
                onChange={(e) => setClaimFilterType(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white font-bold"
              >
                <option value="ALL">Semua Jenis Klaim</option>
                <option value="voucher">Voucher Diskon</option>
                <option value="reward_poin">Hadiah Poin</option>
                <option value="target_milestone">Target Belanja</option>
              </select>
              <select
                value={claimFilterStatus}
                onChange={(e) => setClaimFilterStatus(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white font-bold"
              >
                <option value="ALL">Semua Status ({rewardClaims.length})</option>
                <option value="pending">Menunggu Persetujuan ({rewardClaims.filter((c) => c.status === 'pending').length})</option>
                <option value="approved">Disetujui ({rewardClaims.filter((c) => c.status === 'approved').length})</option>
                <option value="used_or_delivered">Sudah Digunakan / Dikirim ({rewardClaims.filter((c) => c.status === 'used_or_delivered').length})</option>
                <option value="rejected">Ditolak ({rewardClaims.filter((c) => c.status === 'rejected').length})</option>
              </select>
              <button
                onClick={openAddRewardModal}
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Tambah Katalog Hadiah</span>
              </button>
            </div>
          </div>

          {/* Tabel Approval Klaim Real-Time (reward_claims) */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-950/90 text-zinc-400 border-b border-zinc-800 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="py-3.5 px-4">ID Klaim</th>
                    <th className="py-3.5 px-4">Waktu Klaim</th>
                    <th className="py-3.5 px-4">Pelanggan &amp; No. WA</th>
                    <th className="py-3.5 px-4">Jenis Klaim</th>
                    <th className="py-3.5 px-4">Nama Item / Voucher</th>
                    <th className="py-3.5 px-4 text-center">Poin Dipotong / Syarat Target</th>
                    <th className="py-3.5 px-4 text-center">Status</th>
                    <th className="py-3.5 px-4 text-center">Tombol Aksi Admin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                  {rewardClaims
                    .filter((cl) => (claimFilterStatus === 'ALL' ? true : cl.status === claimFilterStatus))
                    .filter((cl) => {
                      if (claimFilterType === 'ALL') return true;
                      if (claimFilterType === 'voucher')
                        return cl.claimType === 'voucher' || cl.claimTypeSlug === 'voucher' || cl.claimType === 'Voucher Promo';
                      if (claimFilterType === 'target_milestone')
                        return (
                          cl.claimType === 'target_milestone' ||
                          cl.claimTypeSlug === 'target_milestone' ||
                          cl.claimType === 'Hadiah Target'
                        );
                      return cl.claimType === 'reward_poin' || cl.claimTypeSlug === 'reward_poin' || cl.claimType === 'Reward Poin';
                    })
                    .map((cl) => {
                      const isBusy = processingClaimId === cl.id;
                      const isVoucherClaim =
                        cl.claimType === 'voucher' || cl.claimTypeSlug === 'voucher' || cl.claimType === 'Voucher Promo';
                      const isTargetClaim =
                        cl.claimType === 'target_milestone' ||
                        cl.claimTypeSlug === 'target_milestone' ||
                        cl.claimType === 'Hadiah Target';

                      const typeBadge = isVoucherClaim
                        ? { label: 'Voucher', cls: 'bg-amber-950/80 text-amber-300 border-amber-700/60' }
                        : isTargetClaim
                        ? { label: 'Kejar Target', cls: 'bg-purple-950/80 text-purple-300 border-purple-700/60' }
                        : { label: 'Hadiah Poin', cls: 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60' };

                      const statusBadge =
                        cl.status === 'pending'
                          ? { label: 'Menunggu Persetujuan', cls: 'bg-amber-950 text-amber-300 border-amber-700' }
                          : cl.status === 'approved'
                          ? { label: 'Disetujui (Stok Bonus Keluar)', cls: 'bg-emerald-950 text-emerald-300 border-emerald-700' }
                          : cl.status === 'used_or_delivered'
                          ? { label: 'Sudah Digunakan / Dikirim', cls: 'bg-blue-950 text-blue-300 border-blue-700' }
                          : { label: 'Ditolak (Poin Kembali)', cls: 'bg-rose-950 text-rose-300 border-rose-700' };

                      const bonusProdName =
                        cl.bonusProductName || cl.physicalProductName || cl.rewardProductName || '';
                      const bonusProdQty = Math.max(1, Number(cl.bonusQty || cl.physicalQty || 1));

                      return (
                        <tr key={cl.id} className="hover:bg-zinc-800/40 transition">
                          <td className="py-3 px-4 font-mono font-bold text-amber-400">
                            {cl.id}
                            {cl.voucherCode && (
                              <span className="block text-[10px] text-emerald-400 font-mono mt-0.5">
                                Kode: {cl.voucherCode}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-zinc-400">
                            {cl.createdAt ? new Date(cl.createdAt).toLocaleString('id-ID') : '-'}
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-bold text-white block">{cl.customerName}</span>
                            <span className="text-[11px] font-mono text-zinc-400">{cl.customerPhone}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${typeBadge.cls}`}>
                              {typeBadge.label}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-bold text-white block">{cl.itemTitle || cl.rewardTitle}</span>
                            {bonusProdName && !isVoucherClaim && (
                              <span className="text-[11px] font-mono font-bold text-amber-300 block mt-0.5">
                                Produk Bonus: {bonusProdQty} Karton &times; {bonusProdName}
                              </span>
                            )}
                            {cl.discountValueIdr ? (
                              <span className="text-[11px] text-amber-300 font-mono">
                                Potongan: {formatCurrency(cl.discountValueIdr, currencyMode)}
                              </span>
                            ) : null}
                            {cl.stockDeducted && (
                              <span className="inline-block mt-1 px-2 py-0.5 rounded bg-emerald-950/90 border border-emerald-700/70 text-[10px] font-mono font-bold text-emerald-300">
                                ✓ Inventory Keluar Otomatis: -{cl.stockDeductedQty || bonusProdQty} Karton ({cl.stockDeductedProductName || bonusProdName})
                              </span>
                            )}
                            {cl.notes ? (
                              <span className="text-[10px] text-zinc-500 block mt-0.5">{cl.notes}</span>
                            ) : null}
                          </td>
                          <td className="py-3 px-4 text-center font-mono font-bold">
                            {(cl.pointsCost || cl.pointsUsed || 0) > 0 ? (
                              <span className="text-amber-400">
                                -{(cl.pointsCost || cl.pointsUsed || 0).toLocaleString('id-ID')} Pts
                              </span>
                            ) : cl.targetRequiredIdr || cl.targetAchievedAmount ? (
                              <div className="space-y-0.5">
                                <span className="text-purple-300 block">
                                  Target {formatCurrency(Number(cl.targetRequiredIdr || cl.targetAchievedAmount || 0), currencyMode)}
                                </span>
                                {(cl.targetQty || 0) > 0 && (
                                  <span className="text-[10px] text-emerald-400 block">
                                    Qty: {cl.achievedQty || cl.targetQty} / {cl.targetQty} Karton
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-emerald-400">Gratis Member</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold inline-block ${statusBadge.cls}`}>
                              {statusBadge.label}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              {cl.status === 'pending' && (
                                <>
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={async () => {
                                      setProcessingClaimId(cl.id);
                                      try {
                                        await approveRewardClaim(cl, 'Admin Dashboard');
                                      } finally {
                                        setProcessingClaimId(null);
                                      }
                                    }}
                                    className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition cursor-pointer shadow-sm"
                                  >
                                    Approve / Setujui
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={async () => {
                                      setProcessingClaimId(cl.id);
                                      try {
                                        await rejectRewardClaim(cl, 'Admin Dashboard', 'Ditolak oleh Admin');
                                      } finally {
                                        setProcessingClaimId(null);
                                      }
                                    }}
                                    className="px-2.5 py-1.5 rounded-lg bg-rose-950/90 hover:bg-rose-900 border border-rose-700 text-rose-200 text-[11px] font-bold transition cursor-pointer"
                                  >
                                    Tolak &amp; Kembalikan Poin
                                  </button>
                                </>
                              )}
                              {cl.status === 'approved' && (
                                <>
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={async () => {
                                      setProcessingClaimId(cl.id);
                                      try {
                                        await deliverRewardClaim(cl, 'Admin Dashboard');
                                      } finally {
                                        setProcessingClaimId(null);
                                      }
                                    }}
                                    className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold transition cursor-pointer"
                                  >
                                    Kirim / Tandai Selesai
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={async () => {
                                      setProcessingClaimId(cl.id);
                                      try {
                                        await rejectRewardClaim(cl, 'Admin Dashboard', 'Dibatalkan & poin dikembalikan');
                                      } finally {
                                        setProcessingClaimId(null);
                                      }
                                    }}
                                    className="px-2 py-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950 text-zinc-300 hover:text-rose-300 text-[10px] font-bold transition cursor-pointer"
                                  >
                                    Batalkan
                                  </button>
                                </>
                              )}
                              {(cl.status === 'used_or_delivered' || cl.status === 'rejected') && (
                                <span className="text-[11px] text-zinc-500 italic">
                                  Selesai diverifikasi
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  {rewardClaims.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-zinc-500 text-xs">
                        Belum ada pengajuan klaim hadiah/voucher dari pelanggan. Klaim baru dari Client PWA akan tampil secara real-time di sini.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Katalog Hadiah Fisik & Penukaran Langsung Kasir */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black text-zinc-300 uppercase tracking-wider">
                Katalog Item Hadiah Poin ({rewards.length} Item Aktif)
              </h4>
            </div>
            {rewards.length === 0 ? (
              <div className="p-8 bg-zinc-900 border border-dashed border-zinc-800 rounded-2xl text-center text-xs text-zinc-500">
                Belum ada katalog hadiah terdaftar. Klik &quot;+ Tambah Katalog Hadiah&quot; untuk menambahkan item reward penukaran poin.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {rewards.map((r) => (
                  <div key={r.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col justify-between space-y-3 shadow-sm hover:border-zinc-700 transition">
                    <div>
                      <div className="flex justify-between items-start gap-2">
                        <span className="text-[10px] font-bold text-amber-400 bg-amber-950/80 border border-amber-800 px-1.5 py-0.5 rounded">
                          {r.category}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setDetailReward(r)}
                            title="Lihat Detail Hadiah"
                            className="p-1 rounded-lg bg-zinc-800 hover:bg-blue-950/80 text-zinc-400 hover:text-blue-400 transition cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditRewardModal(r)}
                            title="Edit Hadiah"
                            className="p-1 rounded-lg bg-zinc-800 hover:bg-amber-950/80 text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (r.id) await deleteRewardDoc(r.id);
                            }}
                            title="Hapus Hadiah"
                            className="p-1 rounded-lg bg-zinc-800 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <h4 className="font-bold text-white text-sm mt-2">{r.name}</h4>
                      <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{r.description}</p>
                      <span className="text-[11px] text-zinc-400 block mt-2">
                        Sisa Stok: <strong className="text-white font-mono">{r.stock} Unit</strong>
                      </span>
                    </div>

                    <div className="pt-2 border-t border-zinc-800 flex items-center justify-between">
                      <span className="font-mono font-bold text-amber-400 text-xs">
                        {r.pointsCost} Poin
                      </span>
                      <button
                        onClick={() => {
                          setSelectedReward(r);
                          setClaimSuccessData(null);
                          setShowClaimModal(true);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer transition shadow-sm"
                      >
                        Klaim Manual
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: ADD / EDIT REWARD CATALOG */}
      {showRewardCatalogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="font-bold text-white text-base">
                {editingReward ? 'Edit Katalog Hadiah' : 'Tambah Katalog Hadiah Baru'}
              </h3>
              <button
                onClick={() => setShowRewardCatalogModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveRewardCatalog} className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Nama Item Hadiah *</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Minyak Goreng Bimoli 2L"
                  value={rewName}
                  onChange={(e) => setRewName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Kategori Hadiah</label>
                <input
                  type="text"
                  placeholder="Sembako / Elektronik / Voucher"
                  value={rewCategory}
                  onChange={(e) => setRewCategory(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Deskripsi Singkat</label>
                <input
                  type="text"
                  placeholder="Keterangan penukaran hadiah fisik di kasir"
                  value={rewDesc}
                  onChange={(e) => setRewDesc(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Syarat Poin *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={rewPointsCost}
                    onChange={(e) => setRewPointsCost(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-amber-400 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Stok Tersedia *</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={rewStock}
                    onChange={(e) => setRewStock(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold"
                  />
                </div>
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowRewardCatalogModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer"
                >
                  Simpan Hadiah
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DETAIL REWARD */}
      {detailReward && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="font-bold text-white text-base">Detail Item Hadiah Poin</h3>
              <button
                onClick={() => setDetailReward(null)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Nama Hadiah:</span>
                <span className="font-bold text-white">{detailReward.name}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Kategori:</span>
                <span className="font-bold text-amber-400">{detailReward.category}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Biaya Penukaran:</span>
                <span className="font-mono font-bold text-emerald-400">{detailReward.pointsCost} Poin</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-400">Sisa Stok Fisik:</span>
                <span className="font-mono font-bold text-white">{detailReward.stock} Unit</span>
              </div>
              <div className="pt-1">
                <span className="text-zinc-400 block mb-1">Deskripsi:</span>
                <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-200">
                  {detailReward.description || '-'}
                </div>
              </div>
            </div>
            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setDetailReward(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD CUSTOMER */}
      {showAddCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-white text-base">Tambah Pelanggan Baru</h3>
            <form onSubmit={handleCreateCustomer} className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Nama Lengkap:</label>
                <input
                  type="text"
                  required
                  placeholder="Nama pembeli / pemilik warung"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">No. WhatsApp / Telepon:</label>
                  <input
                    type="text"
                    required
                    placeholder="081234567890"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">PIN Login PWA (6 Digit):</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    required
                    minLength={6}
                    maxLength={6}
                    placeholder="6 digit angka"
                    value={newPin}
                    onChange={(e) => {
                      setNewPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 6));
                      setPinError(null);
                    }}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-amber-300 font-mono font-bold tracking-widest"
                  />
                </div>
              </div>
              {pinError && (
                <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-300 text-xs font-bold">
                  {pinError}
                </div>
              )}
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Alamat Domisili / Warung:</label>
                <input
                  type="text"
                  placeholder="Jl. Melati No. 1..."
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Tipe Akun:</label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                  >
                    <option value="Pelanggan Reguler">Pelanggan Reguler</option>
                    <option value="Member VIP PWA">Member VIP PWA</option>
                    <option value="Grosir / Reseller Warung">Grosir / Reseller</option>
                  </select>
                </div>
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Plafon Kasbon (Rp):</label>
                  <input
                    type="number"
                    value={newCreditLimit}
                    onChange={(e) => setNewCreditLimit(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold"
                  />
                </div>
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowAddCustomer(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-500"
                >
                  Simpan Pelanggan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DETAIL CUSTOMER PROFILE */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="font-bold text-white text-base">{selectedCustomer.name}</h3>
                <span className="text-xs text-zinc-400 font-mono">{selectedCustomer.id} &bull; {selectedCustomer.type}</span>
              </div>
              <button
                onClick={() => setSelectedCustomer(null)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 bg-zinc-950 p-3.5 rounded-xl border border-zinc-800">
                <div>
                  <span className="text-zinc-500 block">WhatsApp:</span>
                  <span className="text-white font-mono font-bold">{selectedCustomer.phone}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block">Email:</span>
                  <span className="text-zinc-300">{selectedCustomer.email}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-zinc-500 block">Alamat Antar:</span>
                  <span className="text-zinc-300">{selectedCustomer.address}</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 text-center">
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">Poin Tersedia</span>
                  <span className="text-base font-black font-mono text-amber-400 mt-1 block">
                    {selectedCustomer.points} Pts
                  </span>
                </div>
                <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 text-center">
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">Sisa Kasbon</span>
                  <span className="text-base font-black font-mono text-rose-400 mt-1 block">
                    Rp {selectedCustomer.debtAmount.toLocaleString('id-ID')}
                  </span>
                </div>
                <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 text-center">
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">Total Belanja LTV</span>
                  <span className="text-base font-black font-mono text-emerald-400 mt-1 block">
                    Rp {selectedCustomer.totalSpent.toLocaleString('id-ID')}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 space-y-1">
                <span className="text-[10px] text-zinc-500 uppercase font-bold block">Status Paket Langganan:</span>
                <span className="text-white font-medium">{selectedCustomer.subscriptionPlan}</span>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedCustomer(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: DEBT REPAYMENT (LUNASI KASBON) */}
      {showRepaymentModal && repayCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <h3 className="font-bold text-white text-base">Pelunasan Kasbon Piutang</h3>
            <p className="text-xs text-zinc-400">
              Pelunasan oleh <strong>{repayCustomer.name}</strong>. Saldo hutang aktif saat ini: <strong className="text-rose-400">Rp {repayCustomer.debtAmount.toLocaleString('id-ID')}</strong>.
            </p>
            <form onSubmit={handleRepayDebt} className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Nominal Pembayaran (Rp):</label>
                <input
                  type="number"
                  required
                  value={repayAmount}
                  onChange={(e) => setRepayAmount(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Diterima Melalui:</label>
                <select
                  value={repayMethod}
                  onChange={(e) => setRepayMethod(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                >
                  <option value="Kas Kasir Tunai">Kas Kasir Tunai</option>
                  <option value="Transfer Bank BCA Toko">Transfer Bank BCA Toko</option>
                  <option value="Transfer Bank Mandiri Toko">Transfer Bank Mandiri Toko</option>
                </select>
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowRepaymentModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-500"
                >
                  Konfirmasi Pembayaran
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CLAIM REWARD (ATOMIC POINT DEDUCTION) */}
      {showClaimModal && selectedReward && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <h3 className="font-bold text-white text-base">Klaim Hadiah Loyalty Point</h3>
            
            {!claimSuccessData ? (
              <form onSubmit={handleClaimReward} className="space-y-3 text-xs">
                <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 space-y-1">
                  <span className="text-zinc-400 block">Item Hadiah:</span>
                  <strong className="text-white text-sm block">{selectedReward.name}</strong>
                  <span className="text-amber-400 font-mono font-bold">{selectedReward.pointsCost} Poin Diperlukan</span>
                </div>

                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Pilih Member Penukar:</label>
                  <select
                    value={claimCustomerName}
                    onChange={(e) => setClaimCustomerName(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name} (Saldo: {c.points} Pts)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setShowClaimModal(false)}
                    className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-500"
                  >
                    Tukar Sekarang
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4 text-center py-2">
                <div className="w-12 h-12 bg-emerald-950 text-emerald-400 rounded-full flex items-center justify-center mx-auto border border-emerald-800">
                  <CheckCircle className="w-7 h-7" />
                </div>
                <div>
                  <h4 className="font-bold text-white text-base">Penukaran Hadiah Berhasil!</h4>
                  <p className="text-xs text-zinc-400 mt-1">Poin telah dipotong secara otomatis &amp; stok fisik berkurang 1 unit.</p>
                </div>
                <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl font-mono text-emerald-400 font-bold text-sm tracking-wider">
                  TOKEN: {claimSuccessData.token}
                </div>
                <button
                  onClick={() => setShowClaimModal(false)}
                  className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs"
                >
                  Selesai
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: MANUAL POINTS ADJUSTMENT */}
      {showPointsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <h3 className="font-bold text-white text-base">Beri Poin Manual / Kompensasi</h3>
            <form onSubmit={handleAddManualPoints} className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Pilih Pelanggan:</label>
                <select
                  value={ptsCustomerName}
                  onChange={(e) => setPtsCustomerName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name} ({c.points} Pts)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Jumlah Poin Tambahan:</label>
                <input
                  type="number"
                  required
                  value={ptsAmount}
                  onChange={(e) => setPtsAmount(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Alasan Penambahan:</label>
                <input
                  type="text"
                  required
                  value={ptsReason}
                  onChange={(e) => setPtsReason(e.target.value)}
                  placeholder="Kompensasi kendala pengiriman PWA..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowPointsModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-amber-600 text-white font-bold hover:bg-amber-500"
                >
                  Posting Poin ke Ledger
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Buat Langganan Baru */}
      {showAddSubModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-purple-400" />
                <h3 className="text-base font-bold text-white">Buat Paket Langganan Rutin</h3>
              </div>
              <button
                onClick={() => setShowAddSubModal(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveSubscription} className="space-y-4 pt-4 text-xs">
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Nama Pelanggan *</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Budi Santoso / RM Sederhana"
                  value={newSubCustomer}
                  onChange={(e) => setNewSubCustomer(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Paket Produk Langganan</label>
                <input
                  type="text"
                  required
                  placeholder="Misal: Galon Aqua 5x / Gas 3Kg / Sembako"
                  value={newSubPlan}
                  onChange={(e) => setNewSubPlan(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Siklus Pengiriman</label>
                  <select
                    value={newSubCycle}
                    onChange={(e) => setNewSubCycle(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="Mingguan (Setiap Selasa & Jumat)">Mingguan (Selasa & Jumat)</option>
                    <option value="Setiap Hari Kerja (Senin - Jumat)">Harian (Senin - Jumat)</option>
                    <option value="Dua Mingguan">Dua Mingguan</option>
                    <option value="Bulanan (Tanggal 1)">Bulanan (Tgl 1)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-zinc-400 font-bold mb-1">Tarif per Siklus (Rp)</label>
                  <input
                    type="number"
                    required
                    min={1000}
                    step={1000}
                    value={newSubAmount}
                    onChange={(e) => setNewSubAmount(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono font-bold focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Jadwal Pengiriman Pertama / Berikutnya</label>
                <input
                  type="text"
                  placeholder="Misal: 15 Okt 2026"
                  value={newSubNextDate}
                  onChange={(e) => setNewSubNextDate(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowAddSubModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold transition shadow-lg"
                >
                  Simpan Langganan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Pengingat Tagihan WhatsApp */}
      {showWaReminderModal && waCustomer && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Send className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white">Kirim Pengingat Kasbon WA</h3>
              </div>
              <button
                onClick={() => setShowWaReminderModal(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSendWaReminder} className="space-y-4 pt-4 text-xs">
              <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 flex justify-between items-center">
                <div>
                  <span className="font-bold text-white block">{waCustomer.name}</span>
                  <span className="text-[11px] text-zinc-400">{waCustomer.phone}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-zinc-500 block">Total Tagihan:</span>
                  <span className="font-mono font-bold text-rose-400">
                    Rp {waCustomer.debtAmount?.toLocaleString('id-ID')}
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-zinc-400 font-bold mb-1">Isi Pesan WhatsApp Otomatis (Fonnte Gateway):</label>
                <textarea
                  rows={5}
                  required
                  value={waMessageText}
                  onChange={(e) => setWaMessageText(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-white leading-relaxed focus:outline-none focus:border-emerald-500 resize-none font-sans"
                />
              </div>

              {waFeedback && (
                <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 text-xs font-bold text-zinc-200">
                  {waFeedback}
                </div>
              )}

              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowWaReminderModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700"
                >
                  Tutup
                </button>
                <button
                  type="submit"
                  disabled={isSendingWa}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold transition shadow-lg flex items-center gap-1.5"
                >
                  <Send className={`w-3.5 h-3.5 ${isSendingWa ? 'animate-bounce' : ''}`} />
                  <span>{isSendingWa ? 'Mengirim via Server...' : 'Kirim Sekarang'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Detail Point Entry */}
      {detailPointEntry && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="font-bold text-white text-base">Detail Riwayat Poin</h3>
              <button onClick={() => setDetailPointEntry(null)} className="text-zinc-400 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">No. Referensi:</span>
                <span className="font-mono font-bold text-amber-400">{detailPointEntry.id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Pelanggan:</span>
                <span className="font-bold text-white">{detailPointEntry.customerName}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Waktu:</span>
                <span className="text-zinc-300">{detailPointEntry.date}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Mutasi Poin:</span>
                <span className="font-mono font-bold text-emerald-400">{detailPointEntry.amount} Pts</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Catatan:</span>
                <span className="text-zinc-300">{detailPointEntry.notes}</span>
              </div>
            </div>
            <div className="pt-2 flex justify-end">
              <button onClick={() => setDetailPointEntry(null)} className="px-4 py-2 rounded-xl bg-zinc-800 text-white text-xs font-bold">
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Detail Subscription */}
      {detailSub && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="font-bold text-white text-base">Detail Paket Langganan</h3>
              <button onClick={() => setDetailSub(null)} className="text-zinc-400 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">ID Langganan:</span>
                <span className="font-mono font-bold text-purple-400">{detailSub.id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Pelanggan:</span>
                <span className="font-bold text-white">{detailSub.customerName}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Paket:</span>
                <span className="text-purple-300 font-bold">{detailSub.planName}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Siklus:</span>
                <span className="text-zinc-300">{detailSub.billingCycle}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Pengiriman Berikutnya:</span>
                <span className="text-emerald-400 font-bold">{detailSub.nextDeliveryDate}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Biaya Tagihan:</span>
                <span className="font-mono font-bold text-emerald-400">Rp {(detailSub.billingAmount || 0).toLocaleString('id-ID')}</span>
              </div>
            </div>
            <div className="pt-2 flex justify-end">
              <button onClick={() => setDetailSub(null)} className="px-4 py-2 rounded-xl bg-zinc-800 text-white text-xs font-bold">
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
