import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Award,
  Sparkles,
  Plus,
  Search,
  Eye,
  Edit2,
  Trash2,
  X,
  Check,
  AlertCircle,
  FileSpreadsheet,
  Phone,
  Calendar,
  CreditCard,
  Percent,
  Clock,
  ShieldCheck,
  ChevronRight,
  TrendingUp,
  UserCheck,
  DollarSign,
  Gift
} from 'lucide-react';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy
} from 'firebase/firestore';
import { db } from '../../firebase';
import { CustomerType, CustomerItem } from '../../types';
import { ACTIVE_STORE_ID } from '../../config/store';

const STORE_ID = ACTIVE_STORE_ID;

interface CustomerTypesManagerProps {
  onSelectCustomerForDetail?: (customer: CustomerItem) => void;
}

export const CustomerTypesManager: React.FC<CustomerTypesManagerProps> = ({
  onSelectCustomerForDetail
}) => {
  const [customerTypes, setCustomerTypes] = useState<CustomerType[]>([]);
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Selected Type for Filtered Customer Directory Table
  const [selectedType, setSelectedType] = useState<CustomerType | null>(null);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');

  // Modal State for Add / Edit / Detail Customer Type
  const [isTypeModalOpen, setIsTypeModalOpen] = useState(false);
  const [editingType, setEditingType] = useState<CustomerType | null>(null);
  const [detailType, setDetailType] = useState<CustomerType | null>(null);
  const [typeForm, setTypeForm] = useState({
    name: '',
    code: '',
    discountRate: 0,
    pointMultiplier: 1,
    minMonthlySpend: 0,
    description: '',
    status: 'active' as 'active' | 'inactive',
    benefits: ''
  });
  const [typeFormSubmitting, setTypeFormSubmitting] = useState(false);

  // Modal State for Add Customer to this Type
  const [isAddCustomerModalOpen, setIsAddCustomerModalOpen] = useState(false);
  const [customerForm, setCustomerForm] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    creditLimit: 500000
  });
  const [customerFormSubmitting, setCustomerFormSubmitting] = useState(false);

  // Real-time Firestore Sync for Customer Types & Customers
  useEffect(() => {
    let unsubscribeTypes: () => void = () => {};
    let unsubscribeCust: () => void = () => {};

    try {
      const typesColRef = collection(db, 'stores', STORE_ID, 'customer_types');
      const typesQuery = query(typesColRef, orderBy('createdAt', 'asc'));

      unsubscribeTypes = onSnapshot(
        typesQuery,
        (snapshot) => {
          if (snapshot.empty) {
            setCustomerTypes([]);
            setSelectedType(null);
          } else {
            const list: CustomerType[] = snapshot.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<CustomerType, 'id'>)
            }));
            setCustomerTypes(list);
            setSelectedType((prev) => {
              if (!prev) return list[0] || null;
              const found = list.find((item) => item.id === prev.id || item.code === prev.code);
              return found || list[0] || null;
            });
          }
          setLoading(false);
        },
        (err) => {
          console.warn('[CustomerTypesManager] customer_types snapshot warning:', err);
          setCustomerTypes([]);
          setSelectedType(null);
          setLoading(false);
        }
      );

      // Listen to customers collection
      const custColRef = collection(db, 'stores', STORE_ID, 'customers');
      unsubscribeCust = onSnapshot(
        custColRef,
        (snapshot) => {
          if (snapshot.empty) {
            setCustomers([]);
          } else {
            const list: CustomerItem[] = snapshot.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<CustomerItem, 'id'>)
            }));
            setCustomers(list);
          }
        },
        (err) => {
          console.warn('[CustomerTypesManager] customers snapshot warning:', err);
          setCustomers([]);
        }
      );
    } catch (e) {
      console.error('[CustomerTypesManager] Firestore init error:', e);
      setCustomerTypes([]);
      setCustomers([]);
      setSelectedType(null);
      setLoading(false);
    }

    return () => {
      unsubscribeTypes();
      unsubscribeCust();
    };
  }, []);

  // Compute customer count per type
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    customers.forEach((c) => {
      const typeKey = (c.typeCode || c.type || '').toUpperCase();
      counts[typeKey] = (counts[typeKey] || 0) + 1;
      // also key by full name
      const nameKey = (c.type || '').toUpperCase();
      counts[nameKey] = (counts[nameKey] || 0) + 1;
    });
    return counts;
  }, [customers]);

  const getActiveCustomerCountForType = (type: CustomerType) => {
    const codeKey = (type.code || '').toUpperCase();
    const nameKey = (type.name || '').toUpperCase();
    return customers.filter(
      (c) =>
        (c.typeCode && c.typeCode.toUpperCase() === codeKey) ||
        (c.type && c.type.toUpperCase() === nameKey) ||
        (c.type && c.type.toUpperCase().includes(codeKey)) ||
        (c.type && nameKey.includes(c.type.toUpperCase()))
    ).length;
  };

  // Filtered members for the currently selected customer type
  const filteredCustomers = useMemo(() => {
    if (!selectedType) return [];
    const codeKey = (selectedType.code || '').toUpperCase();
    const nameKey = (selectedType.name || '').toUpperCase();

    return customers.filter((c) => {
      const matchesType =
        (c.typeCode && c.typeCode.toUpperCase() === codeKey) ||
        (c.type && c.type.toUpperCase() === nameKey) ||
        (c.type && c.type.toUpperCase().includes(codeKey)) ||
        (c.type && nameKey.includes(c.type.toUpperCase()));

      if (!matchesType) return false;

      if (!customerSearchQuery.trim()) return true;
      const q = customerSearchQuery.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (c.email && c.email.toLowerCase().includes(q))
      );
    });
  }, [customers, selectedType, customerSearchQuery]);

  // Open Add Modal
  const handleOpenAddModal = () => {
    setEditingType(null);
    setTypeForm({
      name: '',
      code: `CUST-TIER${customerTypes.length + 1}`,
      discountRate: 0,
      pointMultiplier: 1,
      minMonthlySpend: 0,
      description: '',
      status: 'active',
      benefits: ''
    });
    setIsTypeModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (t: CustomerType, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingType(t);
    setTypeForm({
      name: t.name,
      code: t.code,
      discountRate: t.discountRate || 0,
      pointMultiplier: t.pointMultiplier || 1,
      minMonthlySpend: t.minMonthlySpend || 0,
      description: t.description || '',
      status: t.status || 'active',
      benefits: t.benefits?.join('\n') || ''
    });
    setIsTypeModalOpen(true);
  };

  const handleDeleteCustomerType = async (t: CustomerType, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!t.id) return;
    try {
      await deleteDoc(doc(db, 'stores', STORE_ID, 'customer_types', t.id));
    } catch (err) {
      console.error('Error deleting customer type:', err);
    }
  };

  // Save or Update Customer Type in Firestore
  const handleSaveCustomerType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typeForm.name.trim() || !typeForm.code.trim()) {
      alert('Please fill in Customer Type Name and Type Code.');
      return;
    }

    setTypeFormSubmitting(true);
    const parsedBenefits = typeForm.benefits
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const typesColRef = collection(db, 'stores', STORE_ID, 'customer_types');

      if (editingType && editingType.id) {
        // Update existing document
        const docRef = doc(typesColRef, editingType.id);
        const updatedData: Partial<CustomerType> = {
          name: typeForm.name.trim(),
          code: typeForm.code.trim().toUpperCase(),
          discountRate: Number(typeForm.discountRate) || 0,
          pointMultiplier: Number(typeForm.pointMultiplier) || 1,
          minMonthlySpend: Number(typeForm.minMonthlySpend) || 0,
          description: typeForm.description.trim(),
          status: typeForm.status,
          benefits: parsedBenefits.length > 0 ? parsedBenefits : editingType.benefits || [],
          updatedAt: new Date().toISOString()
        };
        await updateDoc(docRef, updatedData);

        // Update local state if currently selected
        if (selectedType && selectedType.id === editingType.id) {
          setSelectedType({ ...editingType, ...updatedData });
        }
      } else {
        // Create new document
        const newId = `TYPE-${Date.now().toString().slice(-4)}`;
        const newType: CustomerType = {
          id: newId,
          storeId: STORE_ID,
          name: typeForm.name.trim(),
          code: typeForm.code.trim().toUpperCase(),
          discountRate: Number(typeForm.discountRate) || 0,
          pointMultiplier: Number(typeForm.pointMultiplier) || 1,
          minMonthlySpend: Number(typeForm.minMonthlySpend) || 0,
          description: typeForm.description.trim(),
          status: typeForm.status,
          benefits:
            parsedBenefits.length > 0
              ? parsedBenefits
              : [
                  `Diskon ${typeForm.discountRate}% transaksi katalog`,
                  `Pengali Poin ${typeForm.pointMultiplier}x per transaksi`
                ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await setDoc(doc(typesColRef, newId), newType);
        setSelectedType(newType);
      }

      setIsTypeModalOpen(false);
    } catch (err) {
      console.error('Error saving customer type to Firestore:', err);
      alert('Failed to save Customer Type. Please try again.');
    } finally {
      setTypeFormSubmitting(false);
    }
  };

  // Add Customer to this Type
  const handleAddCustomerToType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedType || !customerForm.name.trim() || !customerForm.phone.trim()) {
      alert('Please enter customer name and WhatsApp number.');
      return;
    }

    setCustomerFormSubmitting(true);
    try {
      const custColRef = collection(db, 'stores', STORE_ID, 'customers');
      const newCustId = `CUST-${(customers.length + 1).toString().padStart(3, '0')}`;
      const newCustomer: CustomerItem = {
        id: newCustId,
        storeId: STORE_ID,
        name: customerForm.name.trim(),
        phone: customerForm.phone.trim(),
        email: customerForm.email.trim() || `${customerForm.name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
        address: customerForm.address.trim() || 'Area Toko Sekitar',
        type: selectedType.name,
        typeCode: selectedType.code,
        creditLimit: Number(customerForm.creditLimit) || 500000,
        points: 100, // welcome bonus points
        debtAmount: 0,
        debtAgeDays: 0,
        subscriptionPlan: 'Non-Langganan',
        totalSpent: 0,
        totalOrders: 0,
        joinedDate: new Date().toISOString().split('T')[0],
        lastTransactionDate: '-',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await setDoc(doc(custColRef, newCustId), newCustomer);
      setIsAddCustomerModalOpen(false);
      setCustomerForm({
        name: '',
        phone: '',
        email: '',
        address: '',
        creditLimit: 500000
      });
    } catch (err) {
      console.error('Error adding customer to Firestore:', err);
      alert('Failed to add customer. Please check Firestore connection.');
    } finally {
      setCustomerFormSubmitting(false);
    }
  };

  // Reassign or remove customer
  const handleRemoveCustomer = async (cust: CustomerItem) => {
    if (confirm(`Remove customer ${cust.name} (${cust.id}) from this list?`)) {
      try {
        const custDocRef = doc(db, 'stores', STORE_ID, 'customers', cust.id);
        await deleteDoc(custDocRef);
      } catch (err) {
        console.error('Error deleting customer:', err);
      }
    }
  };

  const handleReassignCustomer = async (cust: CustomerItem) => {
    const otherTypes = customerTypes.filter((t) => t.code !== cust.typeCode);
    if (otherTypes.length === 0) {
      alert('No other customer types available to reassign.');
      return;
    }
    const targetName = prompt(
      `Reassign ${cust.name} to another tier:\nAvailable: ${otherTypes.map((t) => t.name).join(', ')}\nEnter exact name:`
    );
    if (!targetName) return;

    const matched = customerTypes.find((t) => t.name.toLowerCase() === targetName.toLowerCase().trim());
    if (!matched) {
      alert(`Tier "${targetName}" not found.`);
      return;
    }

    try {
      const custDocRef = doc(db, 'stores', STORE_ID, 'customers', cust.id);
      await updateDoc(custDocRef, {
        type: matched.name,
        typeCode: matched.code,
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error('Error reassigning customer:', err);
      alert('Failed to reassign customer.');
    }
  };

  const handleExportCSV = () => {
    if (filteredCustomers.length === 0) {
      alert('No customers to export.');
      return;
    }
    const headers = ['Customer ID', 'Name', 'Phone', 'Type', 'Orders', 'Total Spent (Rp)', 'Points', 'Debt (Rp)', 'Joined Date'];
    const rows = filteredCustomers.map((c) => [
      c.id,
      `"${c.name}"`,
      `"${c.phone}"`,
      `"${c.type}"`,
      c.totalOrders || 0,
      c.totalSpent,
      c.points,
      c.debtAmount,
      c.joinedDate || '-'
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `customers_${selectedType?.code || 'tier'}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header & Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-[#0f172a] border border-slate-800 shadow-lg">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono tracking-widest uppercase text-cyan-400 bg-cyan-950/60 border border-cyan-800/60 px-2 py-0.5 rounded-md">
              ADMIN / CUSTOMER TIERS
            </span>
          </div>
          <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2.5">
            <Users className="w-5 h-5 text-cyan-400" />
            <span>Customer Types (Tipe Pelanggan)</span>
          </h2>
          <p className="text-xs text-slate-400 max-w-2xl">
            Configure customer tier policies, POS automatic discount rates, loyalty point multipliers, and inspect member directories in real-time.
          </p>
        </div>

        <button
          onClick={handleOpenAddModal}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-600/30 transition-all cursor-pointer whitespace-nowrap active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>+ Add Customer Type</span>
        </button>
      </div>

      {/* Grid of Interactive Customer Type Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {customerTypes.map((type) => {
          const isSelected = selectedType?.code === type.code || selectedType?.id === type.id;
          const memberCount = getActiveCustomerCountForType(type);
          const isVip = type.code.includes('VIP') || type.name.includes('VIP');
          const isWholesale = type.code.includes('WHL') || type.name.includes('GROSIR') || type.name.includes('WHOLESALE');
          const isReseller = type.code.includes('RES') || type.name.includes('RESELLER');

          return (
            <div
              key={type.id || type.code}
              onClick={() => setSelectedType(type)}
              className={`group relative flex flex-col justify-between rounded-2xl p-5 border transition-all duration-200 cursor-pointer text-left ${
                isSelected
                  ? 'bg-[#0f172a] border-cyan-500 shadow-xl shadow-cyan-950/40 ring-1 ring-cyan-500/40 scale-[1.01]'
                  : 'bg-[#0a0f1d] hover:bg-[#0f172a] border-slate-800 hover:border-slate-700 hover:shadow-md'
              }`}
            >
              {/* Card Header & Action Bar */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wide border ${
                        isVip
                          ? 'bg-purple-950/80 text-purple-300 border-purple-700/80'
                          : isWholesale
                          ? 'bg-amber-950/80 text-amber-300 border-amber-700/80'
                          : isReseller
                          ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80'
                          : 'bg-slate-800 text-slate-300 border-slate-700'
                      }`}
                    >
                      {type.code}
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                        type.status === 'active'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {type.status}
                    </span>
                  </div>

                  {/* Top-Right Action Bar */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailType(type);
                      }}
                      title="Lihat Detail Tipe"
                      className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-blue-600 hover:text-white text-slate-300 transition cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => handleOpenEditModal(type, e)}
                      title="Edit Tipe"
                      className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-amber-600 hover:text-white text-slate-300 transition cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => handleDeleteCustomerType(type, e)}
                      title="Hapus Tipe"
                      className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-600 hover:text-white text-slate-300 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Title & Description */}
                <h3 className="font-black text-white text-base tracking-tight mb-1 flex items-center gap-2">
                  <span>{type.name}</span>
                </h3>
                <p className="text-xs text-slate-400 line-clamp-2 min-h-[32px] mb-4">
                  {type.description || 'Standard customer membership policy.'}
                </p>

                {/* Key Metrics Grid */}
                <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-[#050814] border border-slate-800/80 mb-4">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-semibold block">Discount Rate</span>
                    <span className="text-sm font-black text-cyan-400 font-mono flex items-center gap-0.5">
                      <Percent className="w-3 h-3" />
                      {type.discountRate}%
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-semibold block">Point Multiplier</span>
                    <span className="text-sm font-black text-amber-400 font-mono">
                      {type.pointMultiplier}x Bonus
                    </span>
                  </div>
                  <div className="col-span-2 pt-1.5 border-t border-slate-800/60 flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Min. Monthly Spend:</span>
                    <span className="font-mono font-bold text-slate-200">
                      {type.minMonthlySpend && type.minMonthlySpend > 0
                        ? `Rp ${type.minMonthlySpend.toLocaleString('id-ID')}`
                        : 'None'}
                    </span>
                  </div>
                </div>

                {/* Benefits Bullet Preview */}
                {type.benefits && type.benefits.length > 0 && (
                  <div className="space-y-1 text-[11px] text-slate-300 mb-4">
                    {type.benefits.slice(0, 2).map((benefit, idx) => (
                      <div key={idx} className="flex items-start gap-1.5">
                        <Check className="w-3 h-3 text-cyan-400 shrink-0 mt-0.5" />
                        <span className="line-clamp-1">{benefit}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Card Footer: Members Badge & Selection CTA */}
              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between mt-auto">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-950/60 border border-blue-800/50 text-[11px] font-bold text-blue-300">
                  <UserCheck className="w-3.5 h-3.5 text-blue-400" />
                  <span>{memberCount} Customers</span>
                </div>

                <div
                  className={`text-[11px] font-bold flex items-center gap-0.5 transition ${
                    isSelected ? 'text-cyan-400' : 'text-slate-500 group-hover:text-slate-300'
                  }`}
                >
                  <span>{isSelected ? 'Viewing' : 'View Members'}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* FILTERED CUSTOMER DIRECTORY TABLE */}
      {selectedType && (
        <div className="rounded-2xl bg-[#0f172a] border border-slate-800 shadow-xl overflow-hidden animate-fadeIn">
          {/* Table Header & Controls */}
          <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0a0f1d]/60">
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-base font-black text-white tracking-tight">
                  Customers in <span className="text-cyan-400">{selectedType.name}</span>
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-cyan-950 text-cyan-300 border border-cyan-800/60">
                  {filteredCustomers.length} Total
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                  Code: {selectedType.code}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Eligible for {selectedType.discountRate}% discount and {selectedType.pointMultiplier}x point bonus on POS checkout.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Search Bar */}
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search customer name, phone, or code..."
                  value={customerSearchQuery}
                  onChange={(e) => setCustomerSearchQuery(e.target.value)}
                  className="w-full bg-[#050814] border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Add Customer to this Type Button */}
              <button
                onClick={() => setIsAddCustomerModalOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md transition cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Add Customer to this Type</span>
              </button>

              {/* Export/Print Button */}
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 shadow-sm transition cursor-pointer whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                <span>Export / CSV</span>
              </button>
            </div>
          </div>

          {/* Table Content */}
          <div className="overflow-x-auto">
            {filteredCustomers.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
                  <Users className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-white">No customers assigned to {selectedType.name} yet</h4>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Add your first customer or reassign from the Customer Directory using the button above.
                </p>
                <button
                  onClick={() => setIsAddCustomerModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition mt-2 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Add Customer Now</span>
                </button>
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-[#0a0f1d] text-slate-400 border-b border-slate-800 font-mono uppercase text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Customer Code / ID</th>
                    <th className="py-3 px-4">Customer Name</th>
                    <th className="py-3 px-4">Phone (WhatsApp)</th>
                    <th className="py-3 px-4 text-center">Total Orders</th>
                    <th className="py-3 px-4 text-right">Total Spent (Rp)</th>
                    <th className="py-3 px-4 text-right">Loyalty Points</th>
                    <th className="py-3 px-4 text-right">Debt (Hutang)</th>
                    <th className="py-3 px-4 text-center">Joined Date</th>
                    <th className="py-3 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {filteredCustomers.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-3.5 px-4">
                        <span className="font-mono text-[11px] font-bold text-cyan-400 bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-900/60">
                          {c.id}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-white text-sm">{c.name}</div>
                        <div className="text-[10px] text-slate-400">{c.email || c.address}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5 font-mono text-slate-300">
                          <Phone className="w-3 h-3 text-emerald-400" />
                          <span>{c.phone}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-200">
                        {c.totalOrders || Math.floor((c.totalSpent || 500000) / 150000) || 12}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-emerald-400">
                        Rp {(c.totalSpent || 0).toLocaleString('id-ID')}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-amber-400">
                        {(c.points || 0).toLocaleString('id-ID')} Pts
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold">
                        {c.debtAmount > 0 ? (
                          <span className="text-rose-400 bg-rose-950/50 px-2 py-0.5 rounded border border-rose-900/50">
                            Rp {c.debtAmount.toLocaleString('id-ID')}
                          </span>
                        ) : (
                          <span className="text-slate-500">Rp 0</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center text-slate-400 font-mono text-[11px]">
                        {c.joinedDate || '2026-01-15'}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => onSelectCustomerForDetail && onSelectCustomerForDetail(c)}
                            title="Lihat Profil Detail"
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-blue-950 text-slate-300 hover:text-blue-400 transition cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleReassignCustomer(c)}
                            title="Edit / Ubah Tier"
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-amber-950 text-slate-300 hover:text-amber-400 transition cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleRemoveCustomer(c)}
                            title="Hapus Pelanggan"
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-300 hover:text-rose-400 transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* MODAL: ADD / EDIT CUSTOMER TYPE */}
      {isTypeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-fadeIn">
          <div className="bg-[#0f172a] border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden my-8">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-[#0a0f1d]">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Award className="w-4 h-4 text-cyan-400" />
                  <span>{editingType ? 'Edit Customer Type' : '+ Add Customer Type'}</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {editingType ? `Update configuration for ${editingType.name}` : 'Create a new customer tier with discount and point rules.'}
                </p>
              </div>
              <button
                onClick={() => setIsTypeModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomerType} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">Customer Type Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. VIP, WHOLESALE, RESELLER"
                    value={typeForm.name}
                    onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })}
                    className="w-full bg-[#050814] border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-bold"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">Type Code *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. CUST-VIP, CUST-WHL"
                    value={typeForm.code}
                    onChange={(e) => setTypeForm({ ...typeForm, code: e.target.value.toUpperCase() })}
                    className="w-full bg-[#050814] border border-slate-800 rounded-xl px-3 py-2 text-cyan-400 font-mono font-bold uppercase placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">Default Discount Rate (%)</label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={typeForm.discountRate}
                      onChange={(e) => setTypeForm({ ...typeForm, discountRate: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#050814] border border-slate-800 rounded-xl px-3 py-2 pr-8 text-white font-mono focus:outline-none focus:border-cyan-500"
                    />
                    <span className="absolute right-3 top-2 text-slate-400 font-bold">%</span>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1 block">Automatic discount on POS catalogue.</span>
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">Point Multiplier / Bonus (x)</label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={typeForm.pointMultiplier}
                      onChange={(e) => setTypeForm({ ...typeForm, pointMultiplier: parseFloat(e.target.value) || 1 })}
                      className="w-full bg-[#050814] border border-slate-800 rounded-xl px-3 py-2 pr-8 text-white font-mono focus:outline-none focus:border-amber-500"
                    />
                    <span className="absolute right-3 top-2 text-amber-400 font-bold">x</span>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1 block">Reward points multiplier factor.</span>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">Minimum Monthly Spend / Threshold (Rp)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-slate-500 font-bold">Rp</span>
                  <input
                    type="number"
                    min="0"
                    step="50000"
                    value={typeForm.minMonthlySpend}
                    onChange={(e) => setTypeForm({ ...typeForm, minMonthlySpend: parseInt(e.target.value, 10) || 0 })}
                    className="w-full bg-[#050814] border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">Monthly quota spend required to maintain tier.</span>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Describe target customer segment..."
                  value={typeForm.description}
                  onChange={(e) => setTypeForm({ ...typeForm, description: e.target.value })}
                  className="w-full bg-[#050814] border border-slate-800 rounded-xl p-3 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">Benefits List (One per line)</label>
                <textarea
                  rows={3}
                  placeholder="Diskon 5% otomatis&#10;Plafon kasbon tempo 14 hari&#10;Bebas ongkir kurir toko"
                  value={typeForm.benefits}
                  onChange={(e) => setTypeForm({ ...typeForm, benefits: e.target.value })}
                  className="w-full bg-[#050814] border border-slate-800 rounded-xl p-3 text-white placeholder-slate-500 font-mono text-[11px] focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-[#050814] border border-slate-800">
                <div>
                  <span className="font-bold text-white block">Status Tier</span>
                  <span className="text-[10px] text-slate-400">Enable or disable this customer type.</span>
                </div>
                <button
                  type="button"
                  onClick={() => setTypeForm({ ...typeForm, status: typeForm.status === 'active' ? 'inactive' : 'active' })}
                  className={`px-3 py-1.5 rounded-lg font-bold text-xs transition cursor-pointer ${
                    typeForm.status === 'active'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {typeForm.status === 'active' ? 'ACTIVE' : 'INACTIVE'}
                </button>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsTypeModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={typeFormSubmitting}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-lg shadow-blue-600/30 transition cursor-pointer disabled:opacity-50"
                >
                  {typeFormSubmitting ? 'Saving...' : editingType ? 'Update Type' : 'Create Type'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD CUSTOMER TO THIS TYPE */}
      {isAddCustomerModalOpen && selectedType && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-fadeIn">
          <div className="bg-[#0f172a] border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden my-8">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-[#0a0f1d]">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Plus className="w-4 h-4 text-cyan-400" />
                  <span>Add Customer to {selectedType.name}</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Tier Code: <span className="font-mono text-cyan-400">{selectedType.code}</span>
                </p>
              </div>
              <button
                onClick={() => setIsAddCustomerModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddCustomerToType} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">Customer Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Pak Joko Anwar"
                  value={customerForm.name}
                  onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                  className="w-full bg-[#050814] border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-bold"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">Phone Number (WhatsApp) *</label>
                <input
                  type="text"
                  required
                  placeholder="+62 812-xxxx-xxxx"
                  value={customerForm.phone}
                  onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                  className="w-full bg-[#050814] border border-slate-800 rounded-xl px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">Email Address</label>
                <input
                  type="email"
                  placeholder="joko@example.com"
                  value={customerForm.email}
                  onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })}
                  className="w-full bg-[#050814] border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">Delivery Address / Notes</label>
                <textarea
                  rows={2}
                  placeholder="Jl. Melati No. 5..."
                  value={customerForm.address}
                  onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })}
                  className="w-full bg-[#050814] border border-slate-800 rounded-xl p-3 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">Initial Credit Limit (Plafon Kasbon)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-slate-500 font-bold">Rp</span>
                  <input
                    type="number"
                    step="50000"
                    value={customerForm.creditLimit}
                    onChange={(e) => setCustomerForm({ ...customerForm, creditLimit: parseInt(e.target.value, 10) || 0 })}
                    className="w-full bg-[#050814] border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsAddCustomerModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={customerFormSubmitting}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-lg shadow-blue-600/30 transition cursor-pointer disabled:opacity-50"
                >
                  {customerFormSubmitting ? 'Saving...' : 'Add Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DETAIL CUSTOMER TYPE */}
      {detailType && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">{detailType.name}</h3>
                <span className="text-xs font-mono text-cyan-400">{detailType.code}</span>
              </div>
              <button
                onClick={() => setDetailType(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-800/60">
                <span className="text-slate-400">Status Tier:</span>
                <span className="font-bold text-emerald-400 uppercase">{detailType.status}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800/60">
                <span className="text-slate-400">Diskon Otomatis POS:</span>
                <span className="font-mono font-bold text-cyan-400">{detailType.discountRate}%</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800/60">
                <span className="text-slate-400">Pengali Poin Loyalty:</span>
                <span className="font-mono font-bold text-amber-400">{detailType.pointMultiplier}x</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800/60">
                <span className="text-slate-400">Min. Belanja Bulanan:</span>
                <span className="font-mono font-bold text-white">
                  Rp {(detailType.minMonthlySpend || 0).toLocaleString('id-ID')}
                </span>
              </div>
              <div className="pt-1">
                <span className="text-slate-400 block mb-1">Deskripsi &amp; Benefit:</span>
                <div className="p-3 bg-[#050814] border border-slate-800 rounded-xl text-slate-300 space-y-1">
                  <p>{detailType.description || '-'}</p>
                  {detailType.benefits?.map((b, i) => (
                    <div key={i} className="text-[11px] text-cyan-300">• {b}</div>
                  ))}
                </div>
              </div>
            </div>
            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setDetailType(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
