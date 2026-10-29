import { useState, useEffect } from 'react';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ACTIVE_STORE_ID } from '../config/store';
import { ProductBatchItem, RawMaterialRecipeItem } from '../types';
import {
  sanitizeForDatabase,
  syncDocToDatabase,
  deleteDocFromDatabase,
} from '../utils/dbSync';

export interface RawMaterialItem {
  id: string;
  storeId: string;
  sku: string;
  barcode?: string;
  name: string;
  category: string;
  brand: string;
  supplierId?: string;
  supplierName?: string;
  mainUnit: string; // e.g. 'Karung', 'Dus', 'Karton', 'Jerigen', 'Pack', 'Kg', 'Liter'
  subUnit: string; // e.g. 'Kg', 'Gram', 'Liter', 'Ml', 'Pcs', 'Sachet'
  itemsPerCarton: number; // conversion factor: 1 mainUnit = X subUnit
  stock: number; // stock in mainUnit (or base unit)
  stockInSubUnits: number; // stock * itemsPerCarton
  minStock: number;
  costPrice: number; // cost per 1 mainUnit
  costPerSubUnit: number; // costPrice / itemsPerCarton
  sellPrice?: number;
  weightMl?: number;
  totalBeratKg?: number;
  storageLocation: string;
  batchCode?: string;
  productionDate?: string;
  expiryDate?: string;
  batches?: ProductBatchItem[];
  imageUrl?: string;
  galleryImages?: string[];
  description?: string;
  isActive: boolean;
  trackStockCard: boolean;
  sellByUnit?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RawMaterialSupplier {
  id: string;
  storeId: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  email?: string;
  address: string;
  category: string;
  leadTimeDays: number;
  paymentTerms: 'COD' | 'TOP 7 Hari' | 'TOP 14 Hari' | 'TOP 30 Hari' | 'Transfer';
  rating: number;
  totalDebt: number;
  status: 'active' | 'inactive';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RawMaterialPOItem {
  rawMaterialId: string;
  rawMaterialName: string;
  sku: string;
  qty: number;
  unit: string;
  buyPrice: number;
  subtotal: number;
  batchCode?: string;
  productionDate?: string;
  expiryDate?: string;
}

export interface RawMaterialPurchaseOrder {
  id: string;
  storeId: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  orderDate: string;
  expectedDate: string;
  receivedDate?: string;
  status: 'Draft' | 'Ordered' | 'Received' | 'Cancelled';
  paymentStatus: 'Unpaid' | 'Partial' | 'Paid';
  paymentMethod: 'Cash' | 'Transfer' | 'Hutang Tempo';
  items: RawMaterialPOItem[];
  totalAmount: number;
  paidAmount: number;
  remainingDebt: number;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RawMaterialPurchaseRequest {
  id: string;
  storeId: string;
  prNumber: string;
  requestDate: string;
  requestedBy: string;
  urgency: 'Normal' | 'High' | 'Critical';
  status: 'Pending' | 'Approved' | 'Converted_PO' | 'Rejected';
  supplierId?: string;
  supplierName?: string;
  items: Array<{
    rawMaterialId: string;
    rawMaterialName: string;
    sku: string;
    currentStock: number;
    requestedQty: number;
    unit: string;
    estimatedCost: number;
    subtotal: number;
    reason?: string;
  }>;
  totalEstimatedCost: number;
  notes?: string;
  linkedPoNumber?: string;
  source?: 'Manual' | 'AI_Bahan_Baku' | 'Direct_Procurement';
  createdAt: string;
  updatedAt: string;
}

export interface RawMaterialMovement {
  id: string;
  storeId: string;
  rawMaterialId: string;
  rawMaterialName: string;
  sku: string;
  type: 'inflow' | 'outflow' | 'opname' | 'bom_deduction' | 'po_receive' | 'direct_purchase';
  qtyChange: number;
  previousStock: number;
  newStock: number;
  unit: string;
  costPerUnit: number;
  totalValue: number;
  referenceId?: string;
  productName?: string;
  batchCode?: string;
  notes?: string;
  operator?: string;
  createdAt: string;
}

const LS_RAW_MATERIALS_KEY = 'riskcart_fs_raw_materials';
const LS_RM_SUPPLIERS_KEY = 'riskcart_fs_raw_material_suppliers';
const LS_RM_POS_KEY = 'riskcart_fs_raw_material_pos';
const LS_RM_PRS_KEY = 'riskcart_fs_raw_material_prs';
const LS_RM_MOVEMENTS_KEY = 'riskcart_fs_raw_material_movements';
export const RAW_MATERIALS_UPDATED_EVENT = 'riskcart-raw-materials-updated';

export const emitRawMaterialsUpdated = (updatedList?: any) => {
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(RAW_MATERIALS_UPDATED_EVENT, { detail: updatedList }));
      window.dispatchEvent(
        new CustomEvent('riskcart:raw-materials-updated', { detail: updatedList })
      );
      window.dispatchEvent(new Event('storage'));
    } catch {}
  }
};

if (typeof window !== 'undefined') {
  (window as any).emitRawMaterialsUpdated = emitRawMaterialsUpdated;
}

function stripUndefined<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefined) as unknown as T;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj as Record<string, any>)) {
    if (v !== undefined) out[k] = stripUndefined(v);
  }
  return out as T;
}

function readLocalCache<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalCache<T>(key: string, data: T[], shouldEmit = true) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(data));
    if (shouldEmit) {
      emitRawMaterialsUpdated(data);
    }
  } catch {}
}

export function normalizeRawMaterial(raw: any, docId?: string): RawMaterialItem {
  const id = String(docId || raw?.id || raw?.sku || `RM-${Date.now()}`);
  const sku = String(raw?.sku || id);
  const itemsPerCarton = Math.max(1, Number(raw?.itemsPerCarton ?? raw?.isiPerDus ?? raw?.piecesPerCarton ?? 1));
  const stock = Math.max(0, Number(raw?.stock ?? raw?.stockInUnits ?? 0));
  const costPrice = Math.max(0, Number(raw?.costPrice ?? raw?.costPerUnit ?? raw?.buyPrice ?? 0));
  const costPerSubUnit = Math.round(costPrice / itemsPerCarton);
  const weightMl = Math.max(0, Number(raw?.weightMl ?? raw?.beratPerItem ?? 0));
  const totalBeratKg =
    raw?.totalBeratKg !== undefined && raw?.totalBeratKg !== null
      ? Number(raw.totalBeratKg)
      : Number(((weightMl * itemsPerCarton) / 1000).toFixed(3));

  return {
    id,
    storeId: raw?.storeId || ACTIVE_STORE_ID,
    sku,
    barcode: raw?.barcode || sku,
    name: String(raw?.name || 'Bahan Baku'),
    category: String(raw?.category || 'BAHAN BAKU UTAMA'),
    brand: String(raw?.brand || ''),
    supplierId: raw?.supplierId || '',
    supplierName: raw?.supplierName || '',
    mainUnit: String(raw?.mainUnit || 'Karung'),
    subUnit: String(raw?.subUnit || 'Kg'),
    itemsPerCarton,
    stock,
    stockInSubUnits: Number((stock * itemsPerCarton).toFixed(2)),
    minStock: Math.max(0, Number(raw?.minStock ?? raw?.minStockAlert ?? 5)),
    costPrice,
    costPerSubUnit,
    sellPrice: Number(raw?.sellPrice ?? costPrice),
    weightMl,
    totalBeratKg,
    storageLocation: String(raw?.storageLocation || raw?.shelfLocation || 'Gudang Bahan Baku'),
    batchCode: raw?.batchCode || raw?.batches?.[0]?.batchCode || '',
    productionDate: raw?.productionDate || raw?.tanggalProduksi || '',
    expiryDate: raw?.expiryDate || raw?.tanggalKadaluarsa || '',
    batches: Array.isArray(raw?.batches) ? raw.batches : [],
    imageUrl: raw?.imageUrl || '',
    galleryImages: Array.isArray(raw?.galleryImages) ? raw.galleryImages : [],
    description: raw?.description || '',
    isActive: raw?.isActive !== false,
    trackStockCard: raw?.trackStockCard !== false,
    sellByUnit: Boolean(raw?.sellByUnit),
    createdAt: raw?.createdAt || new Date().toISOString(),
    updatedAt: raw?.updatedAt || new Date().toISOString(),
  };
}

const ARABIAN_SEED_TIMESTAMP = '2026-03-01T08:00:00.000Z';

const RAW_MATERIAL_DEFINITIONS: Array<{
  id: string;
  sku: string;
  name: string;
  category: string;
  costPrice: number;
  brand?: string;
  supplierId?: string;
  supplierName?: string;
}> = [
  // === ARABIAN FOOD RAW MATERIALS (33 ITEMS) ===
  { id: 'bb_arb_01', sku: 'BB-ARB-001', name: 'Nasi Basmati (matang)', category: 'BAHAN BAKU UTAMA', costPrice: 35000 },
  { id: 'bb_arb_02', sku: 'BB-ARB-002', name: 'Ayam Panggang', category: 'PROTEIN & DAGING', costPrice: 65000 },
  { id: 'bb_arb_03', sku: 'BB-ARB-003', name: 'Bumbu Mandhi', category: 'BUMBU & REMPAH ARAB', costPrice: 120000 },
  { id: 'bb_arb_04', sku: 'BB-ARB-004', name: 'Kismis', category: 'TOPPING & KACANG', costPrice: 90000 },
  { id: 'bb_arb_05', sku: 'BB-ARB-005', name: 'Kacang Almond', category: 'TOPPING & KACANG', costPrice: 180000 },
  { id: 'bb_arb_06', sku: 'BB-ARB-006', name: 'Bawang Goreng', category: 'TOPPING & PELENGKAP', costPrice: 80000 },
  { id: 'bb_arb_07', sku: 'BB-ARB-007', name: 'Daging Domba', category: 'PROTEIN & DAGING', costPrice: 160000 },
  { id: 'bb_arb_08', sku: 'BB-ARB-008', name: 'Ayam Kabsa', category: 'PROTEIN & DAGING', costPrice: 65000 },
  { id: 'bb_arb_09', sku: 'BB-ARB-009', name: 'Bumbu Kabsa', category: 'BUMBU & REMPAH ARAB', costPrice: 120000 },
  { id: 'bb_arb_10', sku: 'BB-ARB-010', name: 'Kacang Mete', category: 'TOPPING & KACANG', costPrice: 150000 },
  { id: 'bb_arb_11', sku: 'BB-ARB-011', name: 'Roti Flatbread', category: 'ROTI & BAKERY ARAB', costPrice: 45000 },
  { id: 'bb_arb_12', sku: 'BB-ARB-012', name: 'Ayam Shawarma', category: 'PROTEIN & DAGING', costPrice: 70000 },
  { id: 'bb_arb_13', sku: 'BB-ARB-013', name: 'Sayuran (selada, tomat, timun)', category: 'SAYURAN SEGAR', costPrice: 25000 },
  { id: 'bb_arb_14', sku: 'BB-ARB-014', name: 'Saus Garlic', category: 'SAUS & DRESSING', costPrice: 60000 },
  { id: 'bb_arb_15', sku: 'BB-ARB-015', name: 'Saus Tahini', category: 'SAUS & DRESSING', costPrice: 95000 },
  { id: 'bb_arb_16', sku: 'BB-ARB-016', name: 'Daging Sapi Shawarma', category: 'PROTEIN & DAGING', costPrice: 135000 },
  { id: 'bb_arb_17', sku: 'BB-ARB-017', name: 'Kacang Arab (Chickpeas)', category: 'BAHAN BAKU UTAMA', costPrice: 55000 },
  { id: 'bb_arb_18', sku: 'BB-ARB-018', name: 'Tahini', category: 'SAUS & DRESSING', costPrice: 110000 },
  { id: 'bb_arb_19', sku: 'BB-ARB-019', name: 'Minyak Zaitun', category: 'MINYAK & LEMAK', costPrice: 140000 },
  { id: 'bb_arb_20', sku: 'BB-ARB-020', name: 'Bawang Putih', category: 'BUMBU & REMPAH ARAB', costPrice: 45000 },
  { id: 'bb_arb_21', sku: 'BB-ARB-021', name: 'Air Lemon', category: 'BUMBU & REMPAH ARAB', costPrice: 40000 },
  { id: 'bb_arb_22', sku: 'BB-ARB-022', name: 'Falafel', category: 'BAHAN BAKU UTAMA', costPrice: 60000 },
  { id: 'bb_arb_23', sku: 'BB-ARB-023', name: 'Roti Pita', category: 'ROTI & BAKERY ARAB', costPrice: 45000 },
  { id: 'bb_arb_24', sku: 'BB-ARB-024', name: 'Acar', category: 'TOPPING & PELENGKAP', costPrice: 35000 },
  { id: 'bb_arb_25', sku: 'BB-ARB-025', name: 'Daging Kebab', category: 'PROTEIN & DAGING', costPrice: 135000 },
  { id: 'bb_arb_26', sku: 'BB-ARB-026', name: 'Sayuran (tomat, bawang, selada)', category: 'SAYURAN SEGAR', costPrice: 25000 },
  { id: 'bb_arb_27', sku: 'BB-ARB-027', name: 'Saus Yogurt', category: 'SAUS & DRESSING', costPrice: 65000 },
  { id: 'bb_arb_28', sku: 'BB-ARB-028', name: 'Ayam Kebab', category: 'PROTEIN & DAGING', costPrice: 70000 },
  { id: 'bb_arb_29', sku: 'BB-ARB-029', name: 'Selada', category: 'SAYURAN SEGAR', costPrice: 25000 },
  { id: 'bb_arb_30', sku: 'BB-ARB-030', name: 'Tomat', category: 'SAYURAN SEGAR', costPrice: 20000 },
  { id: 'bb_arb_31', sku: 'BB-ARB-031', name: 'Timun', category: 'SAYURAN SEGAR', costPrice: 15000 },
  { id: 'bb_arb_32', sku: 'BB-ARB-032', name: 'Roti Pita (goreng)', category: 'ROTI & BAKERY ARAB', costPrice: 50000 },
  { id: 'bb_arb_33', sku: 'BB-ARB-033', name: 'Sayuran & Bumbu', category: 'BUMBU & REMPAH ARAB', costPrice: 40000 },

  // === ITALIAN FOOD RAW MATERIALS (28 NEW UNIQUE ITEMS; Ayam Panggang, Minyak Zaitun, Bawang Putih reused above) ===
  { id: 'bb_ita_01', sku: 'BB-ITA-001', name: 'Spaghetti (matang)', category: 'PASTA & KARBOHIDRAT', costPrice: 35000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_02', sku: 'BB-ITA-002', name: 'Daging Sapi Cincang', category: 'PROTEIN & DAGING', costPrice: 130000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_03', sku: 'BB-ITA-003', name: 'Saus Bolognese', category: 'SAUS & DRESSING', costPrice: 65000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_04', sku: 'BB-ITA-004', name: 'Keju Parmesan', category: 'KEJU & DAIRY', costPrice: 220000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_05', sku: 'BB-ITA-005', name: 'Fettuccine (matang)', category: 'PASTA & KARBOHIDRAT', costPrice: 38000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_06', sku: 'BB-ITA-006', name: 'Saus Alfredo', category: 'SAUS & DRESSING', costPrice: 85000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_07', sku: 'BB-ITA-007', name: 'Dough (adonan pizza)', category: 'ROTI & ADONAN', costPrice: 30000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_08', sku: 'BB-ITA-008', name: 'Saus Tomat', category: 'SAUS & DRESSING', costPrice: 40000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_09', sku: 'BB-ITA-009', name: 'Keju Mozzarella', category: 'KEJU & DAIRY', costPrice: 135000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_10', sku: 'BB-ITA-010', name: 'Tomat Segar', category: 'SAYURAN SEGAR', costPrice: 22000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_11', sku: 'BB-ITA-011', name: 'Daun Basil', category: 'BUMBU & HERBS ITALIA', costPrice: 80000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_12', sku: 'BB-ITA-012', name: 'Pepperoni', category: 'PROTEIN & DAGING', costPrice: 160000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_13', sku: 'BB-ITA-013', name: 'Daun Oregano', category: 'BUMBU & HERBS ITALIA', costPrice: 90000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_14', sku: 'BB-ITA-014', name: 'Pasta Sheet', category: 'PASTA & KARBOHIDRAT', costPrice: 55000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_15', sku: 'BB-ITA-015', name: 'Saus Bechamel', category: 'SAUS & DRESSING', costPrice: 60000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_16', sku: 'BB-ITA-016', name: 'Saus Carbonara', category: 'SAUS & DRESSING', costPrice: 85000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_17', sku: 'BB-ITA-017', name: 'Smoked Beef (bacon)', category: 'PROTEIN & DAGING', costPrice: 120000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_18', sku: 'BB-ITA-018', name: 'Udang', category: 'SEAFOOD SEGAR', costPrice: 110000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_19', sku: 'BB-ITA-019', name: 'Cumi-cumi', category: 'SEAFOOD SEGAR', costPrice: 95000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_20', sku: 'BB-ITA-020', name: 'Cabai', category: 'BUMBU & HERBS ITALIA', costPrice: 60000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_21', sku: 'BB-ITA-021', name: 'Beras Arborio (matang)', category: 'PASTA & KARBOHIDRAT', costPrice: 65000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_22', sku: 'BB-ITA-022', name: 'Jamur Mix', category: 'SAYURAN SEGAR', costPrice: 75000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_23', sku: 'BB-ITA-023', name: 'Kaldu Sayuran', category: 'SAUS & DRESSING', costPrice: 25000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_24', sku: 'BB-ITA-024', name: 'Bawang Bombay', category: 'SAYURAN SEGAR', costPrice: 38000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_25', sku: 'BB-ITA-025', name: 'Roti Ciabatta', category: 'ROTI & ADONAN', costPrice: 55000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_26', sku: 'BB-ITA-026', name: 'Selada Romaine', category: 'SAYURAN SEGAR', costPrice: 35000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_27', sku: 'BB-ITA-027', name: 'Croutons', category: 'TOPPING & PELENGKAP', costPrice: 60000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },
  { id: 'bb_ita_28', sku: 'BB-ITA-028', name: 'Saus Caesar', category: 'SAUS & DRESSING', costPrice: 80000, brand: 'La Bella Italia Kitchen', supplierId: 'sup_ita_01', supplierName: 'La Bella Italian Food Supply' },

  // === SINGAPORE FOOD RAW MATERIALS (36 NEW UNIQUE ITEMS; Timun, Bawang Putih, Cabai, Udang reused above) ===
  { id: 'bb_sgp_01', sku: 'BB-SGP-001', name: 'Nasi Hainan (matang)', category: 'BAHAN BAKU UTAMA', costPrice: 25000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_02', sku: 'BB-SGP-002', name: 'Ayam Rebus', category: 'PROTEIN & DAGING', costPrice: 60000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_03', sku: 'BB-SGP-003', name: 'Saus Jahe', category: 'SAUS & DRESSING', costPrice: 55000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_04', sku: 'BB-SGP-004', name: 'Saus Chili', category: 'SAUS & DRESSING', costPrice: 50000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_05', sku: 'BB-SGP-005', name: 'Kepiting', category: 'SEAFOOD SEGAR', costPrice: 180000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_06', sku: 'BB-SGP-006', name: 'Telur', category: 'PROTEIN & DAGING', costPrice: 30000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_07', sku: 'BB-SGP-007', name: 'Daun Bawang', category: 'SAYURAN SEGAR', costPrice: 25000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_08', sku: 'BB-SGP-008', name: 'Mi (matang)', category: 'MIE & KARBOHIDRAT', costPrice: 28000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_09', sku: 'BB-SGP-009', name: 'Fish Cake', category: 'SEAFOOD SEGAR', costPrice: 75000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_10', sku: 'BB-SGP-010', name: 'Tahu', category: 'BAHAN BAKU UTAMA', costPrice: 20000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_11', sku: 'BB-SGP-011', name: 'Saus Laksa', category: 'SAUS & DRESSING', costPrice: 70000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_12', sku: 'BB-SGP-012', name: 'Sambal', category: 'SAUS & DRESSING', costPrice: 55000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_13', sku: 'BB-SGP-013', name: 'Kwetiau (matang)', category: 'MIE & KARBOHIDRAT', costPrice: 28000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_14', sku: 'BB-SGP-014', name: 'Tauge', category: 'SAYURAN SEGAR', costPrice: 15000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_15', sku: 'BB-SGP-015', name: 'Kucai', category: 'SAYURAN SEGAR', costPrice: 30000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_16', sku: 'BB-SGP-016', name: 'Saus Kecap', category: 'SAUS & DRESSING', costPrice: 40000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_17', sku: 'BB-SGP-017', name: 'Daging Ayam', category: 'PROTEIN & DAGING', costPrice: 55000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_18', sku: 'BB-SGP-018', name: 'Bumbu Marinasi', category: 'BUMBU & REMPAH ASIA', costPrice: 65000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_19', sku: 'BB-SGP-019', name: 'Saus Kacang', category: 'SAUS & DRESSING', costPrice: 50000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_20', sku: 'BB-SGP-020', name: 'Bawang Merah', category: 'BUMBU & REMPAH ASIA', costPrice: 45000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_21', sku: 'BB-SGP-021', name: 'Lontong/Nasi Impit', category: 'BAHAN BAKU UTAMA', costPrice: 20000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_22', sku: 'BB-SGP-022', name: 'Iga Babi', category: 'PROTEIN & DAGING', costPrice: 140000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_23', sku: 'BB-SGP-023', name: 'Kuah Herbal', category: 'BUMBU & REMPAH ASIA', costPrice: 45000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_24', sku: 'BB-SGP-024', name: 'Jamur Shiitake', category: 'SAYURAN SEGAR', costPrice: 90000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_25', sku: 'BB-SGP-025', name: 'Goji Berry', category: 'BUMBU & REMPAH ASIA', costPrice: 150000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_26', sku: 'BB-SGP-026', name: 'Daging Sapi', category: 'PROTEIN & DAGING', costPrice: 135000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_27', sku: 'BB-SGP-027', name: 'Santan', category: 'SAUS & DRESSING', costPrice: 35000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_28', sku: 'BB-SGP-028', name: 'Bumbu Rendang', category: 'BUMBU & REMPAH ASIA', costPrice: 85000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_29', sku: 'BB-SGP-029', name: 'Serai', category: 'BUMBU & REMPAH ASIA', costPrice: 20000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_30', sku: 'BB-SGP-030', name: 'Daun Jeruk', category: 'BUMBU & REMPAH ASIA', costPrice: 40000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_31', sku: 'BB-SGP-031', name: 'Roti Toast', category: 'ROTI & ADONAN', costPrice: 40000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_32', sku: 'BB-SGP-032', name: 'Kaya Spread', category: 'SAUS & DRESSING', costPrice: 75000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_33', sku: 'BB-SGP-033', name: 'Mentega', category: 'KEJU & DAIRY', costPrice: 110000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_34', sku: 'BB-SGP-034', name: 'Telur Setengah Matang', category: 'PROTEIN & DAGING', costPrice: 32000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_35', sku: 'BB-SGP-035', name: 'Kopi/Teh', category: 'MINUMAN & SEDUHAN', costPrice: 80000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },
  { id: 'bb_sgp_36', sku: 'BB-SGP-036', name: 'Sayuran', category: 'SAYURAN SEGAR', costPrice: 25000, brand: 'Merlion Singapore Kitchen', supplierId: 'sup_sgp_01', supplierName: 'Merlion Hawker Food Supply' },

  // === INDONESIAN & GENERAL FOOD RAW MATERIALS (17 NEW UNIQUE ITEMS; Telur, Sayuran, Sambal, Saus Bolognese, Keju Parmesan, Daging Sapi reused above) ===
  { id: 'bb_idn_01', sku: 'BB-IDN-001', name: 'Nasi Putih', category: 'BAHAN BAKU UTAMA', costPrice: 15000, brand: 'Selera Nusantara Kitchen', supplierId: 'sup_idn_01', supplierName: 'Pangan Nusantara Supply' },
  { id: 'bb_idn_02', sku: 'BB-IDN-002', name: 'Ayam', category: 'PROTEIN & DAGING', costPrice: 55000, brand: 'Selera Nusantara Kitchen', supplierId: 'sup_idn_01', supplierName: 'Pangan Nusantara Supply' },
  { id: 'bb_idn_03', sku: 'BB-IDN-003', name: 'Bumbu', category: 'BUMBU & REMPAH NUSANTARA', costPrice: 60000, brand: 'Selera Nusantara Kitchen', supplierId: 'sup_idn_01', supplierName: 'Pangan Nusantara Supply' },
  { id: 'bb_idn_04', sku: 'BB-IDN-004', name: 'Mie', category: 'MIE & KARBOHIDRAT', costPrice: 25000, brand: 'Selera Nusantara Kitchen', supplierId: 'sup_idn_01', supplierName: 'Pangan Nusantara Supply' },
  { id: 'bb_idn_05', sku: 'BB-IDN-005', name: 'Kuah Soto', category: 'BUMBU & REMPAH NUSANTARA', costPrice: 30000, brand: 'Selera Nusantara Kitchen', supplierId: 'sup_idn_01', supplierName: 'Pangan Nusantara Supply' },
  { id: 'bb_idn_06', sku: 'BB-IDN-006', name: 'Ayam Suwir', category: 'PROTEIN & DAGING', costPrice: 65000, brand: 'Selera Nusantara Kitchen', supplierId: 'sup_idn_01', supplierName: 'Pangan Nusantara Supply' },
  { id: 'bb_idn_07', sku: 'BB-IDN-007', name: 'Soun', category: 'MIE & KARBOHIDRAT', costPrice: 35000, brand: 'Selera Nusantara Kitchen', supplierId: 'sup_idn_01', supplierName: 'Pangan Nusantara Supply' },
  { id: 'bb_idn_08', sku: 'BB-IDN-008', name: 'Pelengkap', category: 'TOPPING & PELENGKAP', costPrice: 40000, brand: 'Selera Nusantara Kitchen', supplierId: 'sup_idn_01', supplierName: 'Pangan Nusantara Supply' },
  { id: 'bb_idn_09', sku: 'BB-IDN-009', name: 'Daging Rendang', category: 'PROTEIN & DAGING', costPrice: 145000, brand: 'Selera Nusantara Kitchen', supplierId: 'sup_idn_01', supplierName: 'Pangan Nusantara Supply' },
  { id: 'bb_idn_10', sku: 'BB-IDN-010', name: 'Spaghetti', category: 'PASTA & KARBOHIDRAT', costPrice: 35000, brand: 'Selera Nusantara Kitchen', supplierId: 'sup_idn_01', supplierName: 'Pangan Nusantara Supply' },
  { id: 'bb_idn_11', sku: 'BB-IDN-011', name: 'Daging Cincang', category: 'PROTEIN & DAGING', costPrice: 130000, brand: 'Selera Nusantara Kitchen', supplierId: 'sup_idn_01', supplierName: 'Pangan Nusantara Supply' },
  { id: 'bb_idn_12', sku: 'BB-IDN-012', name: 'Sayuran Mix', category: 'SAYURAN SEGAR', costPrice: 30000, brand: 'Selera Nusantara Kitchen', supplierId: 'sup_idn_01', supplierName: 'Pangan Nusantara Supply' },
  { id: 'bb_idn_13', sku: 'BB-IDN-013', name: 'Saus', category: 'SAUS & DRESSING', costPrice: 40000, brand: 'Selera Nusantara Kitchen', supplierId: 'sup_idn_01', supplierName: 'Pangan Nusantara Supply' },
  { id: 'bb_idn_14', sku: 'BB-IDN-014', name: 'Ikan', category: 'SEAFOOD SEGAR', costPrice: 65000, brand: 'Selera Nusantara Kitchen', supplierId: 'sup_idn_01', supplierName: 'Pangan Nusantara Supply' },
  { id: 'bb_idn_15', sku: 'BB-IDN-015', name: 'Roti Burger', category: 'ROTI & ADONAN', costPrice: 45000, brand: 'Selera Nusantara Kitchen', supplierId: 'sup_idn_01', supplierName: 'Pangan Nusantara Supply' },
  { id: 'bb_idn_16', sku: 'BB-IDN-016', name: 'Keju', category: 'KEJU & DAIRY', costPrice: 110000, brand: 'Selera Nusantara Kitchen', supplierId: 'sup_idn_01', supplierName: 'Pangan Nusantara Supply' },
  { id: 'bb_idn_17', sku: 'BB-IDN-017', name: 'Dressing', category: 'SAUS & DRESSING', costPrice: 75000, brand: 'Selera Nusantara Kitchen', supplierId: 'sup_idn_01', supplierName: 'Pangan Nusantara Supply' },
];

export const ARABIAN_RAW_MATERIALS: RawMaterialItem[] = RAW_MATERIAL_DEFINITIONS.map((def) =>
  normalizeRawMaterial(
    {
      id: def.id,
      storeId: ACTIVE_STORE_ID,
      sku: def.sku,
      barcode: def.sku,
      name: def.name,
      category: def.category,
      brand: def.brand || 'Al-Barakah Kitchen',
      supplierId: def.supplierId || 'sup_arb_01',
      supplierName: def.supplierName || 'Al-Barakah Arabian Food Supply',
      mainUnit: 'Kg',
      subUnit: 'Gram',
      itemsPerCarton: 1,
      stock: 50,
      stockInSubUnits: 50,
      minStock: 5,
      costPrice: def.costPrice,
      costPerSubUnit: def.costPrice,
      sellPrice: def.costPrice,
      weightMl: 1000,
      totalBeratKg: 1,
      storageLocation: 'Gudang Bahan Baku Utama',
      batchCode: `BATCH-${def.sku}`,
      productionDate: '2026-03-01',
      expiryDate: '2026-12-31',
      description: `Bahan baku standar resep (${def.name}) - Satuan gudang Kg`,
      isActive: true,
      trackStockCard: true,
      sellByUnit: false,
      createdAt: ARABIAN_SEED_TIMESTAMP,
      updatedAt: ARABIAN_SEED_TIMESTAMP,
    },
    def.id
  )
);

const RM_BY_ID = new Map<string, RawMaterialItem>(
  ARABIAN_RAW_MATERIALS.map((rm) => [rm.id, rm])
);

function makeBomRecipeRow(rmId: string, gramQty: number): RawMaterialRecipeItem {
  const rm = RM_BY_ID.get(rmId);
  const costPerKg = rm ? rm.costPrice : 0;
  const subtotalCost = Math.round((gramQty / 1000) * costPerKg);
  return {
    rawMaterialId: rmId,
    rawMaterialName: rm ? rm.name : rmId,
    rawMaterialSku: rm ? rm.sku : rmId,
    qtyPerUnit: gramQty,
    unit: 'Gram',
    costPerUnit: costPerKg,
    subtotalCost,
    wastagePercent: 0,
  };
}

export const ARABIAN_FOOD_CATEGORIES: string[] = [
  'Arabian Food / Main Course',
  'Arabian Food / Wrap & Grill',
  'Arabian Food / Appetizer',
  'Arabian Food / Salad',
  'Italian Food / Pasta',
  'Italian Food / Pizza',
  'Italian Food / Main Course',
  'Italian Food / Appetizer',
  'Italian Food / Salad',
  'Singapore Food / Main Course',
  'Singapore Food / Seafood',
  'Singapore Food / Noodles & Soup',
  'Singapore Food / Grill & Satay',
  'Singapore Food / Breakfast & Toast',
  'Nusantara Food / Main Course',
  'Nusantara Food / Noodles',
  'Nusantara Food / Soup',
  'General Food / Pasta & Western',
  'General Food / Salad',
];

interface ArabianProductSeedSpec {
  id: string;
  sku: string;
  name: string;
  category: string;
  brand?: string;
  storageLocation?: string;
  sellPrice: number;
  weightGrams: number;
  totalBeratKg: number;
  description: string;
  recipe: Array<{ rmId: string; grams: number }>;
}

const ARABIAN_PRODUCT_SPECS: ArabianProductSeedSpec[] = [
  // === 10 ARABIAN FOOD PRODUCTS ===
  {
    id: 'prod_arb_01',
    sku: 'PRD-ARB-001',
    name: 'Chicken Mandhi',
    category: 'Arabian Food / Main Course',
    sellPrice: 65000,
    weightGrams: 600,
    totalBeratKg: 0.6,
    description: 'Nasi Basmati Mandhi autentik dengan ayam panggang rempah khas Timur Tengah, kismis, kacang almond, dan bawang goreng.',
    recipe: [
      { rmId: 'bb_arb_01', grams: 300 },
      { rmId: 'bb_arb_02', grams: 250 },
      { rmId: 'bb_arb_03', grams: 20 },
      { rmId: 'bb_arb_04', grams: 10 },
      { rmId: 'bb_arb_05', grams: 10 },
      { rmId: 'bb_arb_06', grams: 10 },
    ],
  },
  {
    id: 'prod_arb_02',
    sku: 'PRD-ARB-002',
    name: 'Lamb Mandi',
    category: 'Arabian Food / Main Course',
    sellPrice: 115000,
    weightGrams: 650,
    totalBeratKg: 0.65,
    description: 'Nasi Basmati Mandhi spesial dengan daging domba panggang lembut, bumbu mandhi autentik, kismis, kacang almond, dan bawang goreng.',
    recipe: [
      { rmId: 'bb_arb_01', grams: 300 },
      { rmId: 'bb_arb_07', grams: 300 },
      { rmId: 'bb_arb_03', grams: 20 },
      { rmId: 'bb_arb_04', grams: 10 },
      { rmId: 'bb_arb_05', grams: 10 },
      { rmId: 'bb_arb_06', grams: 10 },
    ],
  },
  {
    id: 'prod_arb_03',
    sku: 'PRD-ARB-003',
    name: 'Chicken Kabsa',
    category: 'Arabian Food / Main Course',
    sellPrice: 65000,
    weightGrams: 600,
    totalBeratKg: 0.6,
    description: 'Hidangan nasi Basmati Kabsa harum berempah dengan ayam kabsa panggang, kacang mete, kismis, dan bawang goreng.',
    recipe: [
      { rmId: 'bb_arb_01', grams: 300 },
      { rmId: 'bb_arb_08', grams: 250 },
      { rmId: 'bb_arb_09', grams: 20 },
      { rmId: 'bb_arb_10', grams: 10 },
      { rmId: 'bb_arb_04', grams: 10 },
      { rmId: 'bb_arb_06', grams: 10 },
    ],
  },
  {
    id: 'prod_arb_04',
    sku: 'PRD-ARB-004',
    name: 'Shawarma Chicken',
    category: 'Arabian Food / Wrap & Grill',
    sellPrice: 35000,
    weightGrams: 300,
    totalBeratKg: 0.3,
    description: 'Gulungan roti flatbread lembut berisi irisan ayam shawarma panggang, sayuran segar, saus garlic, dan saus tahini.',
    recipe: [
      { rmId: 'bb_arb_11', grams: 100 },
      { rmId: 'bb_arb_12', grams: 120 },
      { rmId: 'bb_arb_13', grams: 50 },
      { rmId: 'bb_arb_14', grams: 20 },
      { rmId: 'bb_arb_15', grams: 10 },
    ],
  },
  {
    id: 'prod_arb_05',
    sku: 'PRD-ARB-005',
    name: 'Shawarma Beef',
    category: 'Arabian Food / Wrap & Grill',
    sellPrice: 50000,
    weightGrams: 320,
    totalBeratKg: 0.32,
    description: 'Gulungan roti flatbread berisi irisan daging sapi shawarma juicy, sayuran segar, saus garlic, dan saus tahini.',
    recipe: [
      { rmId: 'bb_arb_11', grams: 100 },
      { rmId: 'bb_arb_16', grams: 150 },
      { rmId: 'bb_arb_13', grams: 50 },
      { rmId: 'bb_arb_14', grams: 15 },
      { rmId: 'bb_arb_15', grams: 15 },
    ],
  },
  {
    id: 'prod_arb_06',
    sku: 'PRD-ARB-006',
    name: 'Hummus',
    category: 'Arabian Food / Appetizer',
    sellPrice: 28000,
    weightGrams: 200,
    totalBeratKg: 0.2,
    description: 'Hidangan pembuka klasik Timur Tengah dari kacang Arab (chickpeas) lembut, pasta tahini, minyak zaitun extra virgin, bawang putih, dan air lemon.',
    recipe: [
      { rmId: 'bb_arb_17', grams: 150 },
      { rmId: 'bb_arb_18', grams: 20 },
      { rmId: 'bb_arb_19', grams: 15 },
      { rmId: 'bb_arb_20', grams: 10 },
      { rmId: 'bb_arb_21', grams: 5 },
    ],
  },
  {
    id: 'prod_arb_07',
    sku: 'PRD-ARB-007',
    name: 'Falafel Plate',
    category: 'Arabian Food / Appetizer',
    sellPrice: 35000,
    weightGrams: 350,
    totalBeratKg: 0.35,
    description: 'Sajian falafel renyah disajikan bersama roti pita hangat, sayuran segar, saus tahini, dan acar khas Timur Tengah.',
    recipe: [
      { rmId: 'bb_arb_22', grams: 150 },
      { rmId: 'bb_arb_23', grams: 80 },
      { rmId: 'bb_arb_13', grams: 80 },
      { rmId: 'bb_arb_15', grams: 30 },
      { rmId: 'bb_arb_24', grams: 10 },
    ],
  },
  {
    id: 'prod_arb_08',
    sku: 'PRD-ARB-008',
    name: 'Beef Kebab',
    category: 'Arabian Food / Wrap & Grill',
    sellPrice: 65000,
    weightGrams: 450,
    totalBeratKg: 0.45,
    description: 'Sate daging sapi kebab panggang berbumbu rempah Arab disajikan dengan nasi Basmati matang, sayuran segar, saus yogurt, dan roti pita.',
    recipe: [
      { rmId: 'bb_arb_25', grams: 200 },
      { rmId: 'bb_arb_01', grams: 150 },
      { rmId: 'bb_arb_26', grams: 50 },
      { rmId: 'bb_arb_27', grams: 30 },
      { rmId: 'bb_arb_23', grams: 20 },
    ],
  },
  {
    id: 'prod_arb_09',
    sku: 'PRD-ARB-009',
    name: 'Chicken Kebab',
    category: 'Arabian Food / Wrap & Grill',
    sellPrice: 45000,
    weightGrams: 450,
    totalBeratKg: 0.45,
    description: 'Kebab ayam panggang kaya rempah disajikan dengan nasi Basmati matang, sayuran segar, saus garlic, dan roti pita.',
    recipe: [
      { rmId: 'bb_arb_28', grams: 200 },
      { rmId: 'bb_arb_01', grams: 150 },
      { rmId: 'bb_arb_26', grams: 50 },
      { rmId: 'bb_arb_14', grams: 30 },
      { rmId: 'bb_arb_23', grams: 20 },
    ],
  },
  {
    id: 'prod_arb_10',
    sku: 'PRD-ARB-010',
    name: 'Arabic Salad (Fattoush)',
    category: 'Arabian Food / Salad',
    sellPrice: 22000,
    weightGrams: 250,
    totalBeratKg: 0.25,
    description: 'Salad segar khas Timur Tengah (Fattoush) berisi selada, tomat, timun, potongan roti pita goreng renyah, serta sayuran & bumbu khas Arab.',
    recipe: [
      { rmId: 'bb_arb_29', grams: 100 },
      { rmId: 'bb_arb_30', grams: 50 },
      { rmId: 'bb_arb_31', grams: 50 },
      { rmId: 'bb_arb_32', grams: 30 },
      { rmId: 'bb_arb_33', grams: 20 },
    ],
  },

  // === 10 ITALIAN FOOD PRODUCTS ===
  {
    id: 'prod_ita_01',
    sku: 'PRD-ITA-001',
    name: 'Spaghetti Bolognese',
    category: 'Italian Food / Pasta',
    brand: 'La Bella Italia Kitchen',
    storageLocation: 'Dapur Utama Italian Food',
    sellPrice: 52000,
    weightGrams: 350,
    totalBeratKg: 0.35,
    description: 'Spaghetti Italia al dente dengan saus daging sapi cincang Bolognese autentik, taburan keju Parmesan, dan minyak zaitun.',
    recipe: [
      { rmId: 'bb_ita_01', grams: 200 }, // Spaghetti (matang)
      { rmId: 'bb_ita_02', grams: 80 },  // Daging Sapi Cincang
      { rmId: 'bb_ita_03', grams: 50 },  // Saus Bolognese
      { rmId: 'bb_ita_04', grams: 15 },  // Keju Parmesan
      { rmId: 'bb_arb_19', grams: 5 },   // Minyak Zaitun (shared)
    ],
  },
  {
    id: 'prod_ita_02',
    sku: 'PRD-ITA-002',
    name: 'Fettuccine Alfredo',
    category: 'Italian Food / Pasta',
    brand: 'La Bella Italia Kitchen',
    storageLocation: 'Dapur Utama Italian Food',
    sellPrice: 48000,
    weightGrams: 350,
    totalBeratKg: 0.35,
    description: 'Pasta fettuccine lembut berbalut saus creamy Alfredo, potongan ayam panggang, dan keju Parmesan.',
    recipe: [
      { rmId: 'bb_ita_05', grams: 200 }, // Fettuccine (matang)
      { rmId: 'bb_arb_02', grams: 100 }, // Ayam Panggang (shared)
      { rmId: 'bb_ita_06', grams: 40 },  // Saus Alfredo
      { rmId: 'bb_ita_04', grams: 10 },  // Keju Parmesan
    ],
  },
  {
    id: 'prod_ita_03',
    sku: 'PRD-ITA-003',
    name: 'Margherita Pizza',
    category: 'Italian Food / Pizza',
    brand: 'La Bella Italia Kitchen',
    storageLocation: 'Dapur Utama Italian Food',
    sellPrice: 58000,
    weightGrams: 450,
    totalBeratKg: 0.45,
    description: 'Pizza klasik Napoli dengan adonan dough tipis renyah, saus tomat Italia, keju Mozzarella leleh, irisan tomat segar, daun basil, dan minyak zaitun.',
    recipe: [
      { rmId: 'bb_ita_07', grams: 200 }, // Dough (adonan pizza)
      { rmId: 'bb_ita_08', grams: 80 },  // Saus Tomat
      { rmId: 'bb_ita_09', grams: 100 }, // Keju Mozzarella
      { rmId: 'bb_ita_10', grams: 50 },  // Tomat Segar
      { rmId: 'bb_ita_11', grams: 10 },  // Daun Basil
      { rmId: 'bb_arb_19', grams: 10 },  // Minyak Zaitun (shared)
    ],
  },
  {
    id: 'prod_ita_04',
    sku: 'PRD-ITA-004',
    name: 'Pepperoni Pizza',
    category: 'Italian Food / Pizza',
    brand: 'La Bella Italia Kitchen',
    storageLocation: 'Dapur Utama Italian Food',
    sellPrice: 72000,
    weightGrams: 470,
    totalBeratKg: 0.47,
    description: 'Pizza favorit dengan topping irisan beef pepperoni berlimpah, keju Mozzarella, saus tomat, daun oregano, dan minyak zaitun.',
    recipe: [
      { rmId: 'bb_ita_07', grams: 200 }, // Dough (adonan pizza)
      { rmId: 'bb_ita_08', grams: 80 },  // Saus Tomat
      { rmId: 'bb_ita_09', grams: 100 }, // Keju Mozzarella
      { rmId: 'bb_ita_12', grams: 70 },  // Pepperoni
      { rmId: 'bb_ita_13', grams: 10 },  // Daun Oregano
      { rmId: 'bb_arb_19', grams: 10 },  // Minyak Zaitun (shared)
    ],
  },
  {
    id: 'prod_ita_05',
    sku: 'PRD-ITA-005',
    name: 'Lasagna',
    category: 'Italian Food / Pasta',
    brand: 'La Bella Italia Kitchen',
    storageLocation: 'Dapur Utama Italian Food',
    sellPrice: 65000,
    weightGrams: 400,
    totalBeratKg: 0.4,
    description: 'Lapisan pasta sheet panggang berisi daging sapi cincang berbumbu saus tomat, saus Bechamel lembut, dan keju Mozzarella.',
    recipe: [
      { rmId: 'bb_ita_14', grams: 120 }, // Pasta Sheet
      { rmId: 'bb_ita_02', grams: 120 }, // Daging Sapi Cincang
      { rmId: 'bb_ita_08', grams: 80 },  // Saus Tomat
      { rmId: 'bb_ita_15', grams: 60 },  // Saus Bechamel
      { rmId: 'bb_ita_09', grams: 20 },  // Keju Mozzarella
    ],
  },
  {
    id: 'prod_ita_06',
    sku: 'PRD-ITA-006',
    name: 'Chicken Carbonara',
    category: 'Italian Food / Pasta',
    brand: 'La Bella Italia Kitchen',
    storageLocation: 'Dapur Utama Italian Food',
    sellPrice: 50000,
    weightGrams: 350,
    totalBeratKg: 0.36,
    description: 'Spaghetti saus Carbonara creamy dengan potongan ayam panggang, smoked beef (bacon) gurih, dan keju Parmesan.',
    recipe: [
      { rmId: 'bb_ita_01', grams: 200 }, // Spaghetti (matang)
      { rmId: 'bb_arb_02', grams: 80 },  // Ayam Panggang (shared)
      { rmId: 'bb_ita_16', grams: 50 },  // Saus Carbonara
      { rmId: 'bb_ita_04', grams: 15 },  // Keju Parmesan
      { rmId: 'bb_ita_17', grams: 15 },  // Smoked Beef (bacon)
    ],
  },
  {
    id: 'prod_ita_07',
    sku: 'PRD-ITA-007',
    name: 'Seafood Aglio e Olio',
    category: 'Italian Food / Pasta',
    brand: 'La Bella Italia Kitchen',
    storageLocation: 'Dapur Utama Italian Food',
    sellPrice: 55000,
    weightGrams: 350,
    totalBeratKg: 0.37,
    description: 'Spaghetti tumis bawang putih dan minyak zaitun extra virgin dengan udang segar, cumi-cumi, dan sentuhan cabai.',
    recipe: [
      { rmId: 'bb_ita_01', grams: 200 }, // Spaghetti (matang)
      { rmId: 'bb_ita_18', grams: 80 },  // Udang
      { rmId: 'bb_ita_19', grams: 50 },  // Cumi-cumi
      { rmId: 'bb_arb_20', grams: 20 },  // Bawang Putih (shared)
      { rmId: 'bb_ita_20', grams: 5 },   // Cabai
      { rmId: 'bb_arb_19', grams: 15 },  // Minyak Zaitun (shared)
    ],
  },
  {
    id: 'prod_ita_08',
    sku: 'PRD-ITA-008',
    name: 'Mushroom Risotto',
    category: 'Italian Food / Main Course',
    brand: 'La Bella Italia Kitchen',
    storageLocation: 'Dapur Utama Italian Food',
    sellPrice: 54000,
    weightGrams: 350,
    totalBeratKg: 0.35,
    description: 'Hidangan nasi Arborio khas Italia yang dimasak perlahan dengan kaldu sayuran, jamur mix segar, bawang bombay, dan keju Parmesan.',
    recipe: [
      { rmId: 'bb_ita_21', grams: 200 }, // Beras Arborio (matang)
      { rmId: 'bb_ita_22', grams: 80 },  // Jamur Mix
      { rmId: 'bb_ita_23', grams: 40 },  // Kaldu Sayuran
      { rmId: 'bb_ita_04', grams: 20 },  // Keju Parmesan
      { rmId: 'bb_ita_24', grams: 10 },  // Bawang Bombay
    ],
  },
  {
    id: 'prod_ita_09',
    sku: 'PRD-ITA-009',
    name: 'Bruschetta',
    category: 'Italian Food / Appetizer',
    brand: 'La Bella Italia Kitchen',
    storageLocation: 'Dapur Utama Italian Food',
    sellPrice: 26000,
    weightGrams: 250,
    totalBeratKg: 0.21,
    description: 'Roti Ciabatta panggang renyah dengan topping potongan tomat segar, bawang putih, daun basil, dan minyak zaitun.',
    recipe: [
      { rmId: 'bb_ita_25', grams: 100 }, // Roti Ciabatta
      { rmId: 'bb_ita_10', grams: 80 },  // Tomat Segar
      { rmId: 'bb_arb_20', grams: 10 },  // Bawang Putih (shared)
      { rmId: 'bb_ita_11', grams: 10 },  // Daun Basil
      { rmId: 'bb_arb_19', grams: 10 },  // Minyak Zaitun (shared)
    ],
  },
  {
    id: 'prod_ita_10',
    sku: 'PRD-ITA-010',
    name: 'Caesar Salad',
    category: 'Italian Food / Salad',
    brand: 'La Bella Italia Kitchen',
    storageLocation: 'Dapur Utama Italian Food',
    sellPrice: 42000,
    weightGrams: 300,
    totalBeratKg: 0.3,
    description: 'Salad segar selada Romaine renyah dengan irisan ayam panggang, croutons, taburan keju Parmesan, dan balutan saus Caesar spesial.',
    recipe: [
      { rmId: 'bb_ita_26', grams: 100 }, // Selada Romaine
      { rmId: 'bb_arb_02', grams: 100 }, // Ayam Panggang (shared)
      { rmId: 'bb_ita_27', grams: 40 },  // Croutons
      { rmId: 'bb_ita_04', grams: 20 },  // Keju Parmesan
      { rmId: 'bb_ita_28', grams: 40 },  // Saus Caesar
    ],
  },

  // === 10 SINGAPORE FOOD PRODUCTS ===
  {
    id: 'prod_sgp_01',
    sku: 'PRD-SGP-001',
    name: 'Hainanese Chicken Rice',
    category: 'Singapore Food / Main Course',
    brand: 'Merlion Singapore Kitchen',
    storageLocation: 'Dapur Utama Singapore Food',
    sellPrice: 38000,
    weightGrams: 400,
    totalBeratKg: 0.4,
    description: 'Hidangan ikonik nasi Hainan harum kaldu ayam dengan ayam rebus lembut, irisan timun segar, saus jahe, dan saus chili khas Singapura.',
    recipe: [
      { rmId: 'bb_sgp_01', grams: 200 }, // Nasi Hainan (matang)
      { rmId: 'bb_sgp_02', grams: 150 }, // Ayam Rebus
      { rmId: 'bb_arb_31', grams: 30 },  // Timun (shared)
      { rmId: 'bb_sgp_03', grams: 10 },  // Saus Jahe
      { rmId: 'bb_sgp_04', grams: 10 },  // Saus Chili
    ],
  },
  {
    id: 'prod_sgp_02',
    sku: 'PRD-SGP-002',
    name: 'Chili Crab',
    category: 'Singapore Food / Seafood',
    brand: 'Merlion Singapore Kitchen',
    storageLocation: 'Dapur Utama Singapore Food',
    sellPrice: 120000,
    weightGrams: 500,
    totalBeratKg: 0.5,
    description: 'Kepiting segar masak saus chili manis-pedas-gurih khas Singapura yang dikentalkan dengan kocokan telur, bawang putih, cabai, dan daun bawang.',
    recipe: [
      { rmId: 'bb_sgp_05', grams: 300 }, // Kepiting
      { rmId: 'bb_sgp_04', grams: 120 }, // Saus Chili
      { rmId: 'bb_arb_20', grams: 30 },  // Bawang Putih (shared)
      { rmId: 'bb_ita_20', grams: 20 },  // Cabai (shared)
      { rmId: 'bb_sgp_06', grams: 20 },  // Telur
      { rmId: 'bb_sgp_07', grams: 10 },  // Daun Bawang
    ],
  },
  {
    id: 'prod_sgp_03',
    sku: 'PRD-SGP-003',
    name: 'Laksa Singapore',
    category: 'Singapore Food / Noodles & Soup',
    brand: 'Merlion Singapore Kitchen',
    storageLocation: 'Dapur Utama Singapore Food',
    sellPrice: 52000,
    weightGrams: 450,
    totalBeratKg: 0.45,
    description: 'Mi kuah santan rempah Laksa Katong khas Singapura dengan udang segar, fish cake, tahu, dan sambal laksa.',
    recipe: [
      { rmId: 'bb_sgp_08', grams: 200 }, // Mi (matang)
      { rmId: 'bb_ita_18', grams: 100 }, // Udang (shared)
      { rmId: 'bb_sgp_09', grams: 50 },  // Fish Cake
      { rmId: 'bb_sgp_10', grams: 30 },  // Tahu
      { rmId: 'bb_sgp_11', grams: 50 },  // Saus Laksa
      { rmId: 'bb_sgp_12', grams: 20 },  // Sambal
    ],
  },
  {
    id: 'prod_sgp_04',
    sku: 'PRD-SGP-004',
    name: 'Char Kway Teow',
    category: 'Singapore Food / Noodles & Soup',
    brand: 'Merlion Singapore Kitchen',
    storageLocation: 'Dapur Utama Singapore Food',
    sellPrice: 40000,
    weightGrams: 350,
    totalBeratKg: 0.37,
    description: 'Kwetiau goreng wok hei khas hawker Singapura dengan udang, telur, tauge renyah, kucai, dan saus kecap.',
    recipe: [
      { rmId: 'bb_sgp_13', grams: 200 }, // Kwetiau (matang)
      { rmId: 'bb_ita_18', grams: 80 },  // Udang (shared)
      { rmId: 'bb_sgp_06', grams: 50 },  // Telur
      { rmId: 'bb_sgp_14', grams: 20 },  // Tauge
      { rmId: 'bb_sgp_15', grams: 10 },  // Kucai
      { rmId: 'bb_sgp_16', grams: 10 },  // Saus Kecap
    ],
  },
  {
    id: 'prod_sgp_05',
    sku: 'PRD-SGP-005',
    name: 'Chicken Satay',
    category: 'Singapore Food / Grill & Satay',
    brand: 'Merlion Singapore Kitchen',
    storageLocation: 'Dapur Utama Singapore Food',
    sellPrice: 35000,
    weightGrams: 300,
    totalBeratKg: 0.3,
    description: 'Sate ayam panggang bumbu marinasi rempah disajikan dengan saus kacang gurih, timun, bawang merah, dan lontong/nasi impit.',
    recipe: [
      { rmId: 'bb_sgp_17', grams: 150 }, // Daging Ayam
      { rmId: 'bb_sgp_18', grams: 20 },  // Bumbu Marinasi
      { rmId: 'bb_sgp_19', grams: 60 },  // Saus Kacang
      { rmId: 'bb_arb_31', grams: 40 },  // Timun (shared)
      { rmId: 'bb_sgp_20', grams: 20 },  // Bawang Merah
      { rmId: 'bb_sgp_21', grams: 10 },  // Lontong/Nasi Impit
    ],
  },
  {
    id: 'prod_sgp_06',
    sku: 'PRD-SGP-006',
    name: 'Chili Prawn',
    category: 'Singapore Food / Seafood',
    brand: 'Merlion Singapore Kitchen',
    storageLocation: 'Dapur Utama Singapore Food',
    sellPrice: 65000,
    weightGrams: 350,
    totalBeratKg: 0.35,
    description: 'Udang besar tumis saus chili Singapura dengan bawang putih, cabai, dan balutan telur gurih.',
    recipe: [
      { rmId: 'bb_ita_18', grams: 250 }, // Udang (shared)
      { rmId: 'bb_sgp_04', grams: 60 },  // Saus Chili
      { rmId: 'bb_arb_20', grams: 20 },  // Bawang Putih (shared)
      { rmId: 'bb_ita_20', grams: 10 },  // Cabai (shared)
      { rmId: 'bb_sgp_06', grams: 10 },  // Telur
    ],
  },
  {
    id: 'prod_sgp_07',
    sku: 'PRD-SGP-007',
    name: 'Bak Kut Teh',
    category: 'Singapore Food / Noodles & Soup',
    brand: 'Merlion Singapore Kitchen',
    storageLocation: 'Dapur Utama Singapore Food',
    sellPrice: 85000,
    weightGrams: 400,
    totalBeratKg: 0.41,
    description: 'Sup iga klasik dengan kuah herbal lada dan bawang putih, jamur shiitake, serta goji berry.',
    recipe: [
      { rmId: 'bb_sgp_22', grams: 250 }, // Iga Babi
      { rmId: 'bb_sgp_23', grams: 120 }, // Kuah Herbal
      { rmId: 'bb_sgp_24', grams: 20 },  // Jamur Shiitake
      { rmId: 'bb_arb_20', grams: 10 },  // Bawang Putih (shared)
      { rmId: 'bb_sgp_25', grams: 10 },  // Goji Berry
    ],
  },
  {
    id: 'prod_sgp_08',
    sku: 'PRD-SGP-008',
    name: 'Beef Rendang (SG Style)',
    category: 'Singapore Food / Main Course',
    brand: 'Merlion Singapore Kitchen',
    storageLocation: 'Dapur Utama Singapore Food',
    sellPrice: 68000,
    weightGrams: 350,
    totalBeratKg: 0.35,
    description: 'Rendang daging sapi empuk gaya Singapura dimasak dengan santan kental, bumbu rendang, serai, daun jeruk, dan cabai.',
    recipe: [
      { rmId: 'bb_sgp_26', grams: 200 }, // Daging Sapi
      { rmId: 'bb_sgp_27', grams: 60 },  // Santan
      { rmId: 'bb_sgp_28', grams: 60 },  // Bumbu Rendang
      { rmId: 'bb_sgp_29', grams: 10 },  // Serai
      { rmId: 'bb_sgp_30', grams: 10 },  // Daun Jeruk
      { rmId: 'bb_ita_20', grams: 10 },  // Cabai (shared)
    ],
  },
  {
    id: 'prod_sgp_09',
    sku: 'PRD-SGP-009',
    name: 'Kaya Toast Set',
    category: 'Singapore Food / Breakfast & Toast',
    brand: 'Merlion Singapore Kitchen',
    storageLocation: 'Dapur Utama Singapore Food',
    sellPrice: 30000,
    weightGrams: 250,
    totalBeratKg: 0.25,
    description: 'Paket sarapan klasik kopitiam Singapura berisi roti toast panggang dengan selai srikaya (kaya spread) & mentega, telur setengah matang, serta kopi/teh.',
    recipe: [
      { rmId: 'bb_sgp_31', grams: 100 }, // Roti Toast
      { rmId: 'bb_sgp_32', grams: 40 },  // Kaya Spread
      { rmId: 'bb_sgp_33', grams: 20 },  // Mentega
      { rmId: 'bb_sgp_34', grams: 60 },  // Telur Setengah Matang
      { rmId: 'bb_sgp_35', grams: 30 },  // Kopi/Teh
    ],
  },
  {
    id: 'prod_sgp_10',
    sku: 'PRD-SGP-010',
    name: 'Singapore Chili Noodles',
    category: 'Singapore Food / Noodles & Soup',
    brand: 'Merlion Singapore Kitchen',
    storageLocation: 'Dapur Utama Singapore Food',
    sellPrice: 40000,
    weightGrams: 350,
    totalBeratKg: 0.37,
    description: 'Mi goreng pedas gaya Singapura dengan udang segar, telur, tauge, sayuran, dan racikan saus chili spesial.',
    recipe: [
      { rmId: 'bb_sgp_08', grams: 200 }, // Mi (matang)
      { rmId: 'bb_ita_18', grams: 80 },  // Udang (shared)
      { rmId: 'bb_sgp_06', grams: 50 },  // Telur
      { rmId: 'bb_sgp_14', grams: 20 },  // Tauge
      { rmId: 'bb_sgp_04', grams: 10 },  // Saus Chili
      { rmId: 'bb_sgp_36', grams: 10 },  // Sayuran
    ],
  },

  // === 10 INDONESIAN & GENERAL FOOD PRODUCTS ===
  {
    id: 'prod_idn_01',
    sku: 'PRD-IDN-001',
    name: 'Nasi Goreng',
    category: 'Nusantara Food / Main Course',
    brand: 'Selera Nusantara Kitchen',
    storageLocation: 'Dapur Utama Nusantara Food',
    sellPrice: 25000,
    weightGrams: 350,
    totalBeratKg: 0.35,
    description: 'Nasi goreng spesial bumbu rempah Nusantara disajikan dengan suwiran ayam, telur, dan sayuran segar.',
    recipe: [
      { rmId: 'bb_idn_01', grams: 200 }, // Nasi Putih
      { rmId: 'bb_idn_02', grams: 50 },  // Ayam
      { rmId: 'bb_sgp_06', grams: 50 },  // Telur (shared)
      { rmId: 'bb_sgp_36', grams: 30 },  // Sayuran (shared)
      { rmId: 'bb_idn_03', grams: 20 },  // Bumbu
    ],
  },
  {
    id: 'prod_idn_02',
    sku: 'PRD-IDN-002',
    name: 'Mie Goreng',
    category: 'Nusantara Food / Noodles',
    brand: 'Selera Nusantara Kitchen',
    storageLocation: 'Dapur Utama Nusantara Food',
    sellPrice: 24000,
    weightGrams: 300,
    totalBeratKg: 0.3,
    description: 'Mie goreng bumbu racikan khas Nusantara dengan potongan ayam dan sayuran segar.',
    recipe: [
      { rmId: 'bb_idn_04', grams: 200 }, // Mie
      { rmId: 'bb_idn_02', grams: 50 },  // Ayam
      { rmId: 'bb_sgp_36', grams: 30 },  // Sayuran (shared)
      { rmId: 'bb_idn_03', grams: 20 },  // Bumbu
    ],
  },
  {
    id: 'prod_idn_03',
    sku: 'PRD-IDN-003',
    name: 'Ayam Bakar',
    category: 'Nusantara Food / Main Course',
    brand: 'Selera Nusantara Kitchen',
    storageLocation: 'Dapur Utama Nusantara Food',
    sellPrice: 35000,
    weightGrams: 400,
    totalBeratKg: 0.4,
    description: 'Ayam bakar bumbu kecap rempah disajikan lengkap dengan nasi putih hangat, sambal, dan lalapan sayuran.',
    recipe: [
      { rmId: 'bb_idn_02', grams: 200 }, // Ayam
      { rmId: 'bb_idn_01', grams: 150 }, // Nasi Putih
      { rmId: 'bb_sgp_12', grams: 30 },  // Sambal (shared)
      { rmId: 'bb_sgp_36', grams: 20 },  // Sayuran (shared)
    ],
  },
  {
    id: 'prod_idn_04',
    sku: 'PRD-IDN-004',
    name: 'Soto Ayam',
    category: 'Nusantara Food / Soup',
    brand: 'Selera Nusantara Kitchen',
    storageLocation: 'Dapur Utama Nusantara Food',
    sellPrice: 30000,
    weightGrams: 350,
    totalBeratKg: 0.35,
    description: 'Soto ayam kuah kuning kunyit rempah hangat dengan ayam suwir, soun, telur rebus, dan pelengkap koya/bawang.',
    recipe: [
      { rmId: 'bb_idn_05', grams: 200 }, // Kuah Soto
      { rmId: 'bb_idn_06', grams: 80 },  // Ayam Suwir
      { rmId: 'bb_idn_07', grams: 40 },  // Soun
      { rmId: 'bb_sgp_06', grams: 20 },  // Telur (shared)
      { rmId: 'bb_idn_08', grams: 10 },  // Pelengkap
    ],
  },
  {
    id: 'prod_idn_05',
    sku: 'PRD-IDN-005',
    name: 'Nasi Rendang',
    category: 'Nusantara Food / Main Course',
    brand: 'Selera Nusantara Kitchen',
    storageLocation: 'Dapur Utama Nusantara Food',
    sellPrice: 52000,
    weightGrams: 400,
    totalBeratKg: 0.4,
    description: 'Nasi putih hangat disajikan dengan daging rendang rempah autentik, sayuran, dan sambal.',
    recipe: [
      { rmId: 'bb_idn_01', grams: 200 }, // Nasi Putih
      { rmId: 'bb_idn_09', grams: 150 }, // Daging Rendang
      { rmId: 'bb_sgp_36', grams: 30 },  // Sayuran (shared)
      { rmId: 'bb_sgp_12', grams: 20 },  // Sambal (shared)
    ],
  },
  {
    id: 'prod_idn_06',
    sku: 'PRD-IDN-006',
    name: 'Spaghetti Bolognese (Reguler)',
    category: 'General Food / Pasta & Western',
    brand: 'Selera Nusantara Kitchen',
    storageLocation: 'Dapur Utama Nusantara Food',
    sellPrice: 48000,
    weightGrams: 350,
    totalBeratKg: 0.35,
    description: 'Varian Spaghetti Bolognese reguler dengan pasta spaghetti, daging cincang, saus Bolognese, dan taburan keju Parmesan.',
    recipe: [
      { rmId: 'bb_idn_10', grams: 200 }, // Spaghetti
      { rmId: 'bb_idn_11', grams: 80 },  // Daging Cincang
      { rmId: 'bb_ita_03', grams: 50 },  // Saus Bolognese (shared)
      { rmId: 'bb_ita_04', grams: 20 },  // Keju Parmesan (shared)
    ],
  },
  {
    id: 'prod_idn_07',
    sku: 'PRD-IDN-007',
    name: 'Capcay Sayur Ayam',
    category: 'Nusantara Food / Main Course',
    brand: 'Selera Nusantara Kitchen',
    storageLocation: 'Dapur Utama Nusantara Food',
    sellPrice: 28000,
    weightGrams: 300,
    totalBeratKg: 0.3,
    description: 'Tumisan sayuran mix segar dengan potongan ayam, saus gurih, dan bumbu pilihan.',
    recipe: [
      { rmId: 'bb_idn_12', grams: 180 }, // Sayuran Mix
      { rmId: 'bb_idn_02', grams: 70 },  // Ayam
      { rmId: 'bb_idn_13', grams: 30 },  // Saus
      { rmId: 'bb_idn_03', grams: 20 },  // Bumbu
    ],
  },
  {
    id: 'prod_idn_08',
    sku: 'PRD-IDN-008',
    name: 'Ikan Bakar Nasi',
    category: 'Nusantara Food / Main Course',
    brand: 'Selera Nusantara Kitchen',
    storageLocation: 'Dapur Utama Nusantara Food',
    sellPrice: 38000,
    weightGrams: 400,
    totalBeratKg: 0.4,
    description: 'Ikan segar bakar bumbu rempah Nusantara disajikan bersama nasi putih, sambal, dan sayuran lalapan.',
    recipe: [
      { rmId: 'bb_idn_14', grams: 200 }, // Ikan
      { rmId: 'bb_idn_01', grams: 150 }, // Nasi Putih
      { rmId: 'bb_sgp_12', grams: 30 },  // Sambal (shared)
      { rmId: 'bb_sgp_36', grams: 20 },  // Sayuran (shared)
    ],
  },
  {
    id: 'prod_idn_09',
    sku: 'PRD-IDN-009',
    name: 'Beef Cheese Burger',
    category: 'General Food / Pasta & Western',
    brand: 'Selera Nusantara Kitchen',
    storageLocation: 'Dapur Utama Nusantara Food',
    sellPrice: 48000,
    weightGrams: 300,
    totalBeratKg: 0.3,
    description: 'Burger roti lembut dengan patty daging sapi panggang, lelehan keju, sayuran segar, dan saus spesial.',
    recipe: [
      { rmId: 'bb_idn_15', grams: 80 },  // Roti Burger
      { rmId: 'bb_sgp_26', grams: 120 }, // Daging Sapi (shared)
      { rmId: 'bb_idn_16', grams: 30 },  // Keju
      { rmId: 'bb_sgp_36', grams: 40 },  // Sayuran (shared)
      { rmId: 'bb_idn_13', grams: 30 },  // Saus
    ],
  },
  {
    id: 'prod_idn_10',
    sku: 'PRD-IDN-010',
    name: 'Garden Chicken Salad',
    category: 'General Food / Salad',
    brand: 'Selera Nusantara Kitchen',
    storageLocation: 'Dapur Utama Nusantara Food',
    sellPrice: 28000,
    weightGrams: 250,
    totalBeratKg: 0.25,
    description: 'Salad sayuran mix segar dengan potongan ayam, taburan keju, dan balutan saus dressing.',
    recipe: [
      { rmId: 'bb_idn_12', grams: 150 }, // Sayuran Mix
      { rmId: 'bb_idn_02', grams: 50 },  // Ayam
      { rmId: 'bb_idn_17', grams: 30 },  // Dressing
      { rmId: 'bb_idn_16', grams: 20 },  // Keju
    ],
  },
];

export const ARABIAN_FOOD_PRODUCTS: any[] = ARABIAN_PRODUCT_SPECS.map((spec) => {
  const rawMaterialRecipe = spec.recipe.map((r) => makeBomRecipeRow(r.rmId, r.grams));
  const hppTotal = rawMaterialRecipe.reduce((sum, r) => sum + Number(r.subtotalCost || 0), 0);
  return {
    id: spec.id,
    docId: spec.id,
    storeId: ACTIVE_STORE_ID,
    name: spec.name,
    sku: spec.sku,
    barcode: spec.sku,
    category: spec.category,
    brand: spec.brand || 'Al-Barakah Kitchen',
    mainUnit: 'Porsi',
    subUnit: 'Porsi',
    piecesPerCarton: 1,
    isiPerDus: 1,
    itemsPerCarton: 1,
    stock: 999,
    stockInUnits: 999,
    totalStock: 999,
    minStock: 10,
    minStockAlert: 10,
    costPrice: hppTotal,
    costPerUnit: hppTotal,
    costPerCarton: hppTotal,
    buyPrice: hppTotal,
    modal: hppTotal,
    sellPrice: spec.sellPrice,
    pricePerUnit: spec.sellPrice,
    posPrice: spec.sellPrice,
    pwaPrice: spec.sellPrice,
    pricePerCarton: spec.sellPrice,
    cartonWholesalePrice: spec.sellPrice,
    weightMl: spec.weightGrams,
    beratPerItem: spec.weightGrams,
    totalBeratKg: spec.totalBeratKg,
    storageLocation: spec.storageLocation || 'Dapur Utama Arabian Food',
    shelfLocation: spec.storageLocation || 'Dapur Utama Arabian Food',
    description: spec.description,
    isActive: true,
    isPosVisible: true,
    isPwaVisible: true,
    trackStockCard: true,
    sellByUnit: false,
    hasRawMaterials: true,
    autoDeductRawMaterial: true,
    rawMaterialRecipe,
    createdBy: 'user',
    createdAt: ARABIAN_SEED_TIMESTAMP,
    updatedAt: ARABIAN_SEED_TIMESTAMP,
  };
});

let arabianMasterSyncPromise: Promise<void> | null = null;

const CANONICAL_RM_ID_BY_NAME = new Map<string, string>(
  ARABIAN_RAW_MATERIALS.map((rm) => [rm.name.trim().toLowerCase(), rm.id])
);

function deduplicateRawMaterialsByName(items: RawMaterialItem[]): RawMaterialItem[] {
  const byId = new Map<string, RawMaterialItem>();
  const seenNameToId = new Map<string, string>();

  for (const item of items) {
    if (!item || !item.id) continue;
    const normName = String(item.name || '').trim().toLowerCase();
    const canonicalId = CANONICAL_RM_ID_BY_NAME.get(normName);
    const existingIdForName = seenNameToId.get(normName);

    if (existingIdForName && existingIdForName !== item.id) {
      // Keep canonical ID if one of them is canonical
      if (item.id === canonicalId) {
        byId.delete(existingIdForName);
        byId.set(item.id, item);
        seenNameToId.set(normName, item.id);
      }
      continue;
    }

    byId.set(item.id, item);
    if (normName) {
      seenNameToId.set(normName, item.id);
    }
  }

  return Array.from(byId.values());
}

/**
 * Ensures the 61 Master Raw Materials (33 Arabian + 28 unique Italian),
 * 20 BOM Menu Products (10 Arabian + 10 Italian), and 9 Categories
 * are persisted in localStorage and Firestore so `/dashboard/bahan-baku` and `/dashboard/produk`
 * stay 100% synchronized without duplicate raw materials.
 */
export function ensureArabianFoodMasterSynced(): Promise<void> {
  if (arabianMasterSyncPromise) return arabianMasterSyncPromise;

  arabianMasterSyncPromise = (async () => {
    if (typeof window === 'undefined') return;

    // 1. Seed localStorage raw materials immediately (deduplicated by name & ID)
    let deletedRmIds = new Set<string>();
    try {
      const rawDel = localStorage.getItem('riskcart_deleted_raw_materials_v1');
      if (rawDel) deletedRmIds = new Set(JSON.parse(rawDel));
    } catch {}

    const cachedRm = readLocalCache<RawMaterialItem>(LS_RAW_MATERIALS_KEY);
    const rmMap = new Map<string, RawMaterialItem>();
    ARABIAN_RAW_MATERIALS.forEach((rm) => {
      if (!deletedRmIds.has(rm.id)) rmMap.set(rm.id, rm);
    });
    cachedRm.forEach((c) => {
      const norm = normalizeRawMaterial(c, c?.id);
      if (norm.id && !deletedRmIds.has(norm.id)) {
        const canonicalId = CANONICAL_RM_ID_BY_NAME.get(norm.name.trim().toLowerCase());
        const targetId = canonicalId || norm.id;
        if (!deletedRmIds.has(targetId)) {
          rmMap.set(targetId, { ...norm, id: targetId });
        }
      }
    });
    const mergedRmList = deduplicateRawMaterialsByName(Array.from(rmMap.values()));
    writeLocalCache(LS_RAW_MATERIALS_KEY, mergedRmList, true);

    // 2. Seed localStorage products immediately
    let deletedProdIds = new Set<string>();
    try {
      const rawDelProd = localStorage.getItem('riskcart_deleted_fs_products_v1');
      if (rawDelProd) deletedProdIds = new Set(JSON.parse(rawDelProd));
    } catch {}

    try {
      const rawFsProd = localStorage.getItem('riskcart_fs_products') || localStorage.getItem('riskcart_cache_products');
      const existingProds: any[] = rawFsProd ? JSON.parse(rawFsProd) : [];
      const prodMap = new Map<string, any>();
      ARABIAN_FOOD_PRODUCTS.forEach((p) => {
        if (!deletedProdIds.has(p.id) && !deletedProdIds.has(p.sku)) {
          prodMap.set(p.id, p);
        }
      });
      if (Array.isArray(existingProds)) {
        existingProds.forEach((ep) => {
          if (ep?.id && !deletedProdIds.has(ep.id)) {
            const seedMatch = ARABIAN_FOOD_PRODUCTS.find((sp) => sp.id === ep.id);
            prodMap.set(
              ep.id,
              seedMatch && (!Array.isArray(ep.rawMaterialRecipe) || ep.rawMaterialRecipe.length === 0)
                ? { ...ep, ...seedMatch }
                : ep
            );
          }
        });
      }
      const mergedProds = Array.from(prodMap.values());
      localStorage.setItem('riskcart_fs_products', JSON.stringify(mergedProds));
      localStorage.setItem('riskcart_cache_products', JSON.stringify(mergedProds));
    } catch {}

    // 3. Persist to Firestore collections in batches
    try {
      const existingRmSnap = await getDocs(collection(db, 'raw_materials'));
      const existingRmIds = new Set<string>();
      existingRmSnap.forEach((d) => existingRmIds.add(d.id));

      const missingRm = ARABIAN_RAW_MATERIALS.filter(
        (rm) => !deletedRmIds.has(rm.id) && !existingRmIds.has(rm.id)
      );
      if (missingRm.length > 0) {
        const batch = writeBatch(db);
        for (const rm of missingRm) {
          const clean = stripUndefined(rm);
          batch.set(doc(db, 'raw_materials', rm.id), clean, { merge: true });
          batch.set(doc(db, 'bahan_baku', rm.id), clean, { merge: true });
          batch.set(doc(db, 'stores', ACTIVE_STORE_ID, 'raw_materials', rm.id), clean, {
            merge: true,
          });
        }
        await batch.commit();
      }
    } catch (err) {
      console.warn('[MasterFoodSync] Raw materials Firestore sync notice:', err);
    }

    try {
      const existingProdSnap = await getDocs(collection(db, 'products'));
      const existingProdMap = new Map<string, any>();
      existingProdSnap.forEach((d) => existingProdMap.set(d.id, d.data()));

      const toWriteProds = ARABIAN_FOOD_PRODUCTS.filter((p) => {
        if (deletedProdIds.has(p.id) || deletedProdIds.has(p.sku)) return false;
        const ex = existingProdMap.get(p.id);
        if (!ex) return true;
        // Also update if existing doc lacks BOM recipe
        if (!Array.isArray(ex.rawMaterialRecipe) || ex.rawMaterialRecipe.length === 0) return true;
        return false;
      });

      if (toWriteProds.length > 0) {
        const batch = writeBatch(db);
        for (const prod of toWriteProds) {
          const clean = stripUndefined(prod);
          batch.set(doc(db, 'products', prod.id), clean, { merge: true });
          batch.set(doc(db, 'stores', ACTIVE_STORE_ID, 'products', prod.id), clean, {
            merge: true,
          });
        }
        for (const catName of ARABIAN_FOOD_CATEGORIES) {
          const slug = catName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
          const catId = `cat_${slug}`;
          const catPayload = {
            id: catId,
            name: catName,
            slug,
            icon: catName.startsWith('Italian') ? '🍝' : '🍽️',
            storeId: ACTIVE_STORE_ID,
            createdBy: 'user',
            createdAt: ARABIAN_SEED_TIMESTAMP,
            updatedAt: ARABIAN_SEED_TIMESTAMP,
          };
          batch.set(doc(db, 'categories', catId), catPayload, { merge: true });
          batch.set(doc(db, 'stores', ACTIVE_STORE_ID, 'categories', catId), catPayload, {
            merge: true,
          });
        }
        await batch.commit();
      }
    } catch (err) {
      console.warn('[MasterFoodSync] Products Firestore sync notice:', err);
    }
  })();

  return arabianMasterSyncPromise;
}

/**
 * Live hook for Raw Materials (`raw_materials` collection in Firestore + localStorage sync)
 */
export function useRawMaterials() {
  const [rawMaterials, setRawMaterials] = useState<RawMaterialItem[]>(() => {
    const cached = readLocalCache<any>(LS_RAW_MATERIALS_KEY).map((r) =>
      normalizeRawMaterial(r, r?.id)
    );
    const map = new Map<string, RawMaterialItem>();
    ARABIAN_RAW_MATERIALS.forEach((rm) => map.set(rm.id, rm));
    cached.forEach((c) => {
      if (c.id) map.set(c.id, c);
    });
    return deduplicateRawMaterialsByName(Array.from(map.values()));
  });
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    void ensureArabianFoodMasterSynced();

    let rootMap = new Map<string, RawMaterialItem>();
    let bahanBakuMap = new Map<string, RawMaterialItem>();
    let storeMap = new Map<string, RawMaterialItem>();

    const getDeletedRmIds = (): Set<string> => {
      if (typeof window === 'undefined') return new Set();
      try {
        const raw = localStorage.getItem('riskcart_deleted_raw_materials_v1');
        return raw ? new Set(JSON.parse(raw)) : new Set();
      } catch {
        return new Set();
      }
    };

    const syncCombined = () => {
      const deletedIds = getDeletedRmIds();
      const merged = new Map<string, RawMaterialItem>();

      // 0. Baseline Arabian & Italian Food Raw Materials (unless explicitly deleted by user)
      ARABIAN_RAW_MATERIALS.forEach((rm) => {
        if (!deletedIds.has(rm.id)) {
          merged.set(rm.id, rm);
        }
      });

      // 1. Merge local cache so newly saved items are always preserved immediately
      const localItems = readLocalCache<any>(LS_RAW_MATERIALS_KEY);
      localItems.forEach((raw) => {
        const norm = normalizeRawMaterial(raw, raw?.id);
        if (norm.id && !deletedIds.has(norm.id)) {
          merged.set(norm.id, norm);
        }
      });

      // 2. Merge store subcollection, bahan_baku collection, and root raw_materials collection
      const mergeFromMap = (sourceMap: Map<string, RawMaterialItem>) => {
        sourceMap.forEach((v, k) => {
          if (deletedIds.has(k)) return;
          const existing = merged.get(k);
          if (!existing) {
            merged.set(k, v);
          } else {
            const incomingTime = v.updatedAt ? new Date(v.updatedAt).getTime() : 0;
            const existingTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
            merged.set(k, incomingTime >= existingTime ? v : existing);
          }
        });
      };

      mergeFromMap(storeMap);
      mergeFromMap(bahanBakuMap);
      mergeFromMap(rootMap);

      const list = deduplicateRawMaterialsByName(Array.from(merged.values())).sort((a, b) =>
        (a.sku || a.id || '').localeCompare(b.sku || b.id || '', 'id', { numeric: true })
      );
      setRawMaterials(list);
      writeLocalCache(LS_RAW_MATERIALS_KEY, list, false);
      setLoading(false);
    };

    let unsubRoot = () => {};
    let unsubBahanBaku = () => {};
    let unsubStore = () => {};

    try {
      unsubRoot = onSnapshot(
        collection(db, 'raw_materials'),
        (snap) => {
          const next = new Map<string, RawMaterialItem>();
          snap.docs.forEach((d) => {
            next.set(d.id, normalizeRawMaterial(d.data(), d.id));
          });
          rootMap = next;
          syncCombined();
        },
        () => {
          syncCombined();
        }
      );
    } catch {
      syncCombined();
    }

    try {
      unsubBahanBaku = onSnapshot(
        collection(db, 'bahan_baku'),
        (snap) => {
          const next = new Map<string, RawMaterialItem>();
          snap.docs.forEach((d) => {
            next.set(d.id, normalizeRawMaterial(d.data(), d.id));
          });
          bahanBakuMap = next;
          syncCombined();
        },
        () => setLoading(false)
      );
    } catch {}

    try {
      unsubStore = onSnapshot(
        collection(db, 'stores', ACTIVE_STORE_ID, 'raw_materials'),
        (snap) => {
          const next = new Map<string, RawMaterialItem>();
          snap.docs.forEach((d) => {
            next.set(d.id, normalizeRawMaterial(d.data(), d.id));
          });
          storeMap = next;
          syncCombined();
        },
        () => setLoading(false)
      );
    } catch {}

    const handleCustomUpdate = () => {
      const deletedIds = getDeletedRmIds();
      const map = new Map<string, RawMaterialItem>();
      ARABIAN_RAW_MATERIALS.forEach((rm) => {
        if (!deletedIds.has(rm.id)) map.set(rm.id, rm);
      });
      readLocalCache<any>(LS_RAW_MATERIALS_KEY)
        .map((r) => normalizeRawMaterial(r, r?.id))
        .filter((r) => r.id && !deletedIds.has(r.id))
        .forEach((r) => map.set(r.id, r));
      setRawMaterials(
        Array.from(map.values()).sort((a, b) =>
          (a.sku || a.id || '').localeCompare(b.sku || b.id || '', 'id', { numeric: true })
        )
      );
    };
    window.addEventListener(RAW_MATERIALS_UPDATED_EVENT, handleCustomUpdate);

    return () => {
      try {
        unsubRoot();
        unsubBahanBaku();
        unsubStore();
      } catch {}
      window.removeEventListener(RAW_MATERIALS_UPDATED_EVENT, handleCustomUpdate);
    };
  }, []);

  return { rawMaterials, materials: rawMaterials, loading };
}

function sanitizeFirestoreDocId(rawId?: string, prefix = 'RM'): string {
  const cleaned = String(rawId || '')
    .trim()
    .replace(/[\/\\#?]+/g, '-');
  if (cleaned) return cleaned;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/**
 * Save or update a RawMaterialItem in localStorage, global state, and Firestore
 * (`raw_materials`, `bahan_baku`, & `stores/${ACTIVE_STORE_ID}/raw_materials`)
 */
export async function saveRawMaterialInDb(
  item: Partial<RawMaterialItem> & { name: string }
): Promise<RawMaterialItem> {
  const now = new Date().toISOString();
  const docId = sanitizeFirestoreDocId(item.id || item.sku, 'BB');

  // Remove from deleted list if re-saving
  if (typeof window !== 'undefined') {
    try {
      const rawDel = localStorage.getItem('riskcart_deleted_raw_materials_v1');
      if (rawDel) {
        const delSet = new Set<string>(JSON.parse(rawDel));
        if (delSet.has(docId)) {
          delSet.delete(docId);
          localStorage.setItem(
            'riskcart_deleted_raw_materials_v1',
            JSON.stringify(Array.from(delSet))
          );
        }
      }
    } catch {}
  }

  const normalized = normalizeRawMaterial(
    {
      ...item,
      id: docId,
      updatedAt: now,
      createdAt: item.createdAt || now,
    },
    docId
  );

  // Build FEFO batch if batchCode / expiryDate provided
  if (normalized.batchCode || normalized.expiryDate || normalized.productionDate) {
    const existingBatches = Array.isArray(normalized.batches) ? [...normalized.batches] : [];
    const bCode = normalized.batchCode || `BATCH-${docId.slice(0, 6).toUpperCase()}`;
    if (existingBatches.length === 0) {
      existingBatches.push({
        batchCode: bCode,
        productionDate: normalized.productionDate || now.slice(0, 10),
        expiryDate: normalized.expiryDate || '',
        qty: normalized.stock,
        initialQty: normalized.stock,
        buyPrice: normalized.costPrice,
        supplier: normalized.supplierName || '',
        receivedAt: now,
      });
    } else {
      existingBatches[0] = {
        ...existingBatches[0],
        batchCode: bCode,
        productionDate: normalized.productionDate || existingBatches[0].productionDate,
        expiryDate: normalized.expiryDate || existingBatches[0].expiryDate,
        qty: normalized.stock,
        buyPrice: normalized.costPrice,
      };
    }
    normalized.batches = existingBatches;
  }

  // 1. Save immediately to localStorage & trigger UI update so save never fails even if offline
  const cached = readLocalCache<RawMaterialItem>(LS_RAW_MATERIALS_KEY);
  const exists = cached.some((c) => c.id === docId);
  const nextCache = exists
    ? cached.map((c) => (c.id === docId ? normalized : c))
    : [normalized, ...cached];
  writeLocalCache(LS_RAW_MATERIALS_KEY, nextCache, true);

  // 2. Persist to Firestore & Backend collections (`raw_materials`, `bahan_baku`, and store subcollection)
  const payload = sanitizeForDatabase(stripUndefined(normalized));
  await Promise.allSettled([
    syncDocToDatabase('raw_materials', docId, payload),
    syncDocToDatabase('bahan_baku', docId, payload),
    ACTIVE_STORE_ID
      ? syncDocToDatabase(`stores/${ACTIVE_STORE_ID}/raw_materials`, docId, payload)
      : Promise.resolve(true),
  ]);

  emitRawMaterialsUpdated();
  return normalized;
}

export async function deleteRawMaterialFromDb(id: string): Promise<void> {
  const cleanId = sanitizeFirestoreDocId(id);
  if (!cleanId) return;

  if (typeof window !== 'undefined') {
    try {
      const rawDel = localStorage.getItem('riskcart_deleted_raw_materials_v1');
      const delSet = new Set<string>(rawDel ? JSON.parse(rawDel) : []);
      delSet.add(cleanId);
      localStorage.setItem(
        'riskcart_deleted_raw_materials_v1',
        JSON.stringify(Array.from(delSet))
      );
    } catch {}
  }

  const cached = readLocalCache<RawMaterialItem>(LS_RAW_MATERIALS_KEY);
  writeLocalCache(
    LS_RAW_MATERIALS_KEY,
    cached.filter((c) => c.id !== cleanId),
    true
  );

  await Promise.allSettled([
    deleteDocFromDatabase('raw_materials', cleanId),
    deleteDocFromDatabase('bahan_baku', cleanId),
    ACTIVE_STORE_ID
      ? deleteDocFromDatabase(`stores/${ACTIVE_STORE_ID}/raw_materials`, cleanId)
      : Promise.resolve(true),
  ]);

  emitRawMaterialsUpdated();
}

/**
 * Record stock movement for a raw material and update its stock in Firestore + localStorage
 */
export async function adjustRawMaterialStock(params: {
  rawMaterialId: string;
  qtyDelta: number; // positive for inflow, negative for outflow
  type: RawMaterialMovement['type'];
  notes?: string;
  referenceId?: string;
  productName?: string;
  batchCode?: string;
  productionDate?: string;
  expiryDate?: string;
  newBuyPrice?: number;
  supplierName?: string;
  operator?: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const cached = readLocalCache<RawMaterialItem>(LS_RAW_MATERIALS_KEY);
  let target = cached.find(
    (c) =>
      c.id === params.rawMaterialId ||
      c.sku === params.rawMaterialId ||
      c.name?.toLowerCase() === String(params.rawMaterialId || '').toLowerCase()
  );

  if (!target) {
    try {
      const snap = await getDocs(collection(db, 'raw_materials'));
      snap.docs.forEach((d) => {
        if (d.id === params.rawMaterialId || d.data()?.sku === params.rawMaterialId) {
          target = normalizeRawMaterial(d.data(), d.id);
        }
      });
    } catch {}
  }
  if (!target) return;

  const previousStock = Number(target.stock || 0);
  const nextStock = Math.max(0, Number((previousStock + params.qtyDelta).toFixed(4)));
  const updatedCost =
    params.newBuyPrice && params.newBuyPrice > 0 ? params.newBuyPrice : target.costPrice;

  const existingBatches = Array.isArray(target.batches) ? [...target.batches] : [];
  if (params.qtyDelta > 0 && (params.batchCode || params.expiryDate)) {
    existingBatches.push({
      batchCode: params.batchCode || `BATCH-${Date.now().toString().slice(-5)}`,
      productionDate: params.productionDate || now.slice(0, 10),
      expiryDate: params.expiryDate || target.expiryDate || '',
      qty: params.qtyDelta,
      initialQty: params.qtyDelta,
      buyPrice: updatedCost,
      supplier: params.supplierName || target.supplierName || '',
      receivedAt: now,
    });
  }

  await saveRawMaterialInDb({
    ...target,
    stock: nextStock,
    costPrice: updatedCost,
    batchCode: params.batchCode || target.batchCode,
    productionDate: params.productionDate || target.productionDate,
    expiryDate: params.expiryDate || target.expiryDate,
    batches: existingBatches,
    updatedAt: now,
  });

  const movId = `RMMOV-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const movement: RawMaterialMovement = stripUndefined({
    id: movId,
    storeId: ACTIVE_STORE_ID,
    rawMaterialId: target.id,
    rawMaterialName: target.name,
    sku: target.sku,
    type: params.type,
    qtyChange: params.qtyDelta,
    previousStock,
    newStock: nextStock,
    unit: target.mainUnit || 'Kg',
    costPerUnit: updatedCost,
    totalValue: Math.round(Math.abs(params.qtyDelta) * updatedCost),
    referenceId: params.referenceId || '',
    productName: params.productName || '',
    batchCode: params.batchCode || target.batchCode || '',
    notes: params.notes || '',
    operator: params.operator || 'Admin Gudang',
    createdAt: now,
  });

  const prevMovements = readLocalCache<RawMaterialMovement>(LS_RM_MOVEMENTS_KEY);
  writeLocalCache(LS_RM_MOVEMENTS_KEY, [movement, ...prevMovements], true);

  try {
    await setDoc(doc(db, 'raw_material_movements', movId), movement, { merge: true });
  } catch {}
  try {
    await setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'raw_material_movements', movId), movement, {
      merge: true,
    });
  } catch {}

  emitRawMaterialsUpdated();
}

export const BOM_RECIPE_UNITS = [
  'Gram',
  'Kg',
  'ml',
  'Liter',
  'Pcs',
  'Butir',
  'Sachet',
  'Sendok',
  'Potong',
  'Lembar',
  'Botol',
  'Cup',
  'Pack',
  'Kaleng',
  'Dus',
  'Karung',
] as const;

export function isSubThousandBomUnit(unit?: string): boolean {
  const u = String(unit || '').trim().toLowerCase();
  return (
    u === 'gram' ||
    u === 'gr' ||
    u === 'g' ||
    u === 'ml' ||
    u === 'mililiter' ||
    u === 'cc'
  );
}

/**
 * Calculates Subtotal HPP for a single BOM recipe row:
 * - If unit is Gram (gr/g) or ml: (qtyPerUnit / 1000) * costPerUnit * wastageMultiplier
 * - Otherwise (Kg, Liter, Pcs, etc.): qtyPerUnit * costPerUnit * wastageMultiplier
 */
export function computeBomRowSubtotalCost(row: Partial<RawMaterialRecipeItem>): number {
  const qty = Math.max(0, Number(row?.qtyPerUnit || 0));
  const cost = Math.max(0, Number(row?.costPerUnit || 0));
  const wastageMultiplier = 1 + Math.max(0, Number(row?.wastagePercent || 0)) / 100;
  const effectiveQtyForCost = isSubThousandBomUnit(row?.unit) ? qty / 1000 : qty;
  return Math.round(effectiveQtyForCost * cost * wastageMultiplier);
}

export function computeBomTotalCost(recipeRows?: RawMaterialRecipeItem[]): number {
  if (!Array.isArray(recipeRows) || recipeRows.length === 0) return 0;
  return recipeRows.reduce((sum, r) => sum + computeBomRowSubtotalCost(r), 0);
}

/**
 * Calculates Total Berat (kg) from BOM recipe rows:
 * - Gram / ml are divided by 1,000
 * - Kg / Liter (and other whole units) are added directly
 */
export function computeBomTotalWeightKg(recipeRows?: RawMaterialRecipeItem[]): number {
  if (!Array.isArray(recipeRows) || recipeRows.length === 0) return 0;
  const totalKg = recipeRows.reduce((sum, r) => {
    const qty = Math.max(0, Number(r?.qtyPerUnit || 0));
    if (qty <= 0) return sum;
    if (isSubThousandBomUnit(r?.unit)) {
      return sum + qty / 1000;
    }
    return sum + qty;
  }, 0);
  return Number(totalKg.toFixed(3));
}

/**
 * Converts recipe usage quantity (`qtyPerUnit` in `recipeUnit`) into warehouse stock unit (`warehouseMainUnit`).
 * E.g., 10 Gram recipe against Kg warehouse stock -> 0.01 Kg.
 */
export function convertRecipeQtyToWarehouseUnit(
  qtyPerUnit: number,
  recipeUnit?: string,
  warehouseMainUnit?: string
): number {
  const qty = Math.max(0, Number(qtyPerUnit || 0));
  if (qty <= 0) return 0;
  const recIsSub = isSubThousandBomUnit(recipeUnit);
  const whIsSub = isSubThousandBomUnit(warehouseMainUnit);
  if (recIsSub && !whIsSub) {
    return Number((qty / 1000).toFixed(6));
  }
  if (!recIsSub && whIsSub) {
    return Number((qty * 1000).toFixed(6));
  }
  return qty;
}

/**
 * Automatically deducts raw materials based on a product's BOM recipe (`rawMaterialRecipe`)
 * when a product with `hasRawMaterials: true` is sold or produced.
 * Supports both object parameter `{ productId, productName, productQtySoldOrProduced, recipe, referenceId, operator }`
 * and positional arguments `(recipe, productQtySoldOrProduced, productName, referenceId)`.
 */
export async function deductRawMaterialsForProductBom(
  paramsOrRecipe:
    | {
        productId?: string;
        productName: string;
        productQtySoldOrProduced: number;
        recipe: RawMaterialRecipeItem[];
        referenceId: string;
        operator?: string;
      }
    | RawMaterialRecipeItem[],
  qtyArg?: number,
  productNameArg?: string,
  referenceIdArg?: string
): Promise<void> {
  const normalizedParams = Array.isArray(paramsOrRecipe)
    ? {
        productId: '',
        productName: productNameArg || 'Produk BOM',
        productQtySoldOrProduced: Number(qtyArg || 0),
        recipe: paramsOrRecipe,
        referenceId: referenceIdArg || `TX-${Date.now()}`,
        operator: 'Kasir POS (BOM Otomatis)',
      }
    : paramsOrRecipe;

  if (!Array.isArray(normalizedParams.recipe) || normalizedParams.recipe.length === 0) return;
  if (normalizedParams.productQtySoldOrProduced <= 0) return;

  const cachedMaterials = readLocalCache<RawMaterialItem>(LS_RAW_MATERIALS_KEY);

  for (const item of normalizedParams.recipe) {
    if (!item.rawMaterialId || !(Number(item.qtyPerUnit) > 0)) continue;
    const matchedRm = cachedMaterials.find(
      (c) =>
        c.id === item.rawMaterialId ||
        c.sku === item.rawMaterialId ||
        c.name?.toLowerCase() === String(item.rawMaterialName || '').toLowerCase()
    );
    const warehouseUnit = matchedRm?.mainUnit || 'Kg';
    const qtyInWarehouseUnit = convertRecipeQtyToWarehouseUnit(
      Number(item.qtyPerUnit),
      item.unit,
      warehouseUnit
    );
    const wastageFactor = 1 + Math.max(0, Number(item.wastagePercent || 0)) / 100;
    const totalConsumed = Number(
      (
        qtyInWarehouseUnit *
        normalizedParams.productQtySoldOrProduced *
        wastageFactor
      ).toFixed(4)
    );
    if (totalConsumed <= 0) continue;

    await adjustRawMaterialStock({
      rawMaterialId: item.rawMaterialId,
      qtyDelta: -totalConsumed,
      type: 'bom_deduction',
      referenceId: normalizedParams.referenceId,
      productName: normalizedParams.productName,
      notes: `Pemakaian otomatis BOM produk "${normalizedParams.productName}" (${normalizedParams.productQtySoldOrProduced}x @ ${item.qtyPerUnit} ${item.unit} = ${totalConsumed} ${warehouseUnit})`,
      operator: normalizedParams.operator || 'Sistem BOM Otomatis',
    });
  }
}

/**
 * Live hook for Raw Material Suppliers (`raw_material_suppliers` + `suppliers` fallback)
 */
export function useRawMaterialSuppliers() {
  const [suppliers, setSuppliers] = useState<RawMaterialSupplier[]>(() =>
    readLocalCache<RawMaterialSupplier>(LS_RM_SUPPLIERS_KEY)
  );
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let rmSupMap = new Map<string, RawMaterialSupplier>();
    let generalSupMap = new Map<string, RawMaterialSupplier>();

    const normalizeSup = (raw: any, id: string): RawMaterialSupplier => ({
      id,
      storeId: raw?.storeId || ACTIVE_STORE_ID,
      code: raw?.code || raw?.supplierCode || `SUP-BB-${id.slice(0, 4).toUpperCase()}`,
      name: raw?.name || raw?.supplierName || 'Supplier Bahan Baku',
      contactPerson: raw?.contactPerson || raw?.pic || raw?.contact || '-',
      phone: raw?.phone || raw?.whatsapp || '-',
      email: raw?.email || '',
      address: raw?.address || '-',
      category: raw?.category || 'Bahan Baku',
      leadTimeDays: Number(raw?.leadTimeDays ?? raw?.leadTime ?? 2),
      paymentTerms: raw?.paymentTerms || 'COD',
      rating: Number(raw?.rating ?? 5),
      totalDebt: Number(raw?.totalDebt ?? raw?.debt ?? 0),
      status: raw?.status === 'inactive' ? 'inactive' : 'active',
      notes: raw?.notes || '',
      createdAt: raw?.createdAt || new Date().toISOString(),
      updatedAt: raw?.updatedAt || new Date().toISOString(),
    });

    const getDeletedSupplierIds = (): Set<string> => {
      try {
        const raw = localStorage.getItem('riskcart_deleted_rm_suppliers_v1');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return new Set(parsed.map(String));
        }
      } catch {}
      return new Set();
    };

    const syncSuppliers = () => {
      const deletedSet = getDeletedSupplierIds();
      const combined = new Map<string, RawMaterialSupplier>();
      const localList = readLocalCache<any>(LS_RM_SUPPLIERS_KEY);
      localList.forEach((s) => {
        if (s?.id && !deletedSet.has(String(s.id))) combined.set(s.id, normalizeSup(s, s.id));
      });
      generalSupMap.forEach((v, k) => {
        if (!deletedSet.has(k)) combined.set(k, v);
      });
      rmSupMap.forEach((v, k) => {
        if (!deletedSet.has(k)) combined.set(k, v);
      });
      const list = Array.from(combined.values()).sort((a, b) =>
        (a.name || '').localeCompare(b.name || '')
      );
      setSuppliers(list);
      writeLocalCache(LS_RM_SUPPLIERS_KEY, list, false);
      setLoading(false);
    };

    let unsubRm = () => {};
    let unsubGen = () => {};

    try {
      unsubRm = onSnapshot(
        collection(db, 'raw_material_suppliers'),
        (snap) => {
          const next = new Map<string, RawMaterialSupplier>();
          snap.docs.forEach((d) => next.set(d.id, normalizeSup(d.data(), d.id)));
          rmSupMap = next;
          syncSuppliers();
        },
        () => setLoading(false)
      );
    } catch {
      setLoading(false);
    }

    try {
      unsubGen = onSnapshot(
        collection(db, 'suppliers'),
        (snap) => {
          const next = new Map<string, RawMaterialSupplier>();
          snap.docs.forEach((d) => next.set(d.id, normalizeSup(d.data(), d.id)));
          generalSupMap = next;
          syncSuppliers();
        },
        () => setLoading(false)
      );
    } catch {}

    const handleCustomUpdate = () => {
      const cached = readLocalCache<RawMaterialSupplier>(LS_RM_SUPPLIERS_KEY);
      setSuppliers(cached);
    };
    window.addEventListener(RAW_MATERIALS_UPDATED_EVENT, handleCustomUpdate);

    return () => {
      try {
        unsubRm();
        unsubGen();
      } catch {}
      window.removeEventListener(RAW_MATERIALS_UPDATED_EVENT, handleCustomUpdate);
    };
  }, []);

  return { suppliers, loading };
}

export async function saveRawMaterialSupplierInDb(
  sup: Partial<RawMaterialSupplier> & { name: string }
): Promise<RawMaterialSupplier> {
  const now = new Date().toISOString();
  const id = sanitizeFirestoreDocId(sup.id, 'SUPBB');
  const record: RawMaterialSupplier = stripUndefined({
    id,
    storeId: ACTIVE_STORE_ID,
    code: sup.code || `SUP-BB-${id.slice(0, 4).toUpperCase()}`,
    name: sup.name.trim(),
    contactPerson: sup.contactPerson || '-',
    phone: sup.phone || '-',
    email: sup.email || '',
    address: sup.address || '-',
    category: sup.category || 'Bahan Baku Utama',
    leadTimeDays: Number(sup.leadTimeDays ?? 2),
    paymentTerms: sup.paymentTerms || 'COD',
    rating: Number(sup.rating ?? 5),
    totalDebt: Number(sup.totalDebt ?? 0),
    status: sup.status || 'active',
    notes: sup.notes || '',
    createdAt: sup.createdAt || now,
    updatedAt: now,
  });

  const cached = readLocalCache<RawMaterialSupplier>(LS_RM_SUPPLIERS_KEY);
  const exists = cached.some((c) => c.id === id);
  const nextCache = exists
    ? cached.map((c) => (c.id === id ? record : c))
    : [record, ...cached];
  writeLocalCache(LS_RM_SUPPLIERS_KEY, nextCache, true);

  try {
    await setDoc(doc(db, 'raw_material_suppliers', id), record, { merge: true });
  } catch {}
  try {
    await setDoc(doc(db, 'suppliers', id), record, { merge: true });
  } catch {}

  emitRawMaterialsUpdated();
  return record;
}

export async function deleteRawMaterialSupplierFromDb(id: string): Promise<void> {
  if (!id) return;
  try {
    const rawDel = localStorage.getItem('riskcart_deleted_rm_suppliers_v1');
    const delSet = new Set<string>(rawDel ? JSON.parse(rawDel) : []);
    delSet.add(String(id));
    localStorage.setItem('riskcart_deleted_rm_suppliers_v1', JSON.stringify(Array.from(delSet)));
  } catch {}
  const cached = readLocalCache<RawMaterialSupplier>(LS_RM_SUPPLIERS_KEY);
  writeLocalCache(
    LS_RM_SUPPLIERS_KEY,
    cached.filter((c) => c.id !== id),
    true
  );
  try {
    await deleteDoc(doc(db, 'raw_material_suppliers', id));
  } catch {}
  try {
    await deleteDoc(doc(db, 'suppliers', id));
  } catch {}
  emitRawMaterialsUpdated();
}

/**
 * Live hook for Raw Material Purchase Orders (`raw_material_purchase_orders`)
 */
export function useRawMaterialPOs() {
  const [purchaseOrders, setPurchaseOrders] = useState<RawMaterialPurchaseOrder[]>(() =>
    readLocalCache<RawMaterialPurchaseOrder>(LS_RM_POS_KEY)
  );
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let unsub = () => {};
    try {
      unsub = onSnapshot(
        collection(db, 'raw_material_purchase_orders'),
        (snap) => {
          const combined = new Map<string, RawMaterialPurchaseOrder>();
          readLocalCache<RawMaterialPurchaseOrder>(LS_RM_POS_KEY).forEach((p) => {
            if (p?.id) combined.set(p.id, p);
          });
          snap.docs.forEach((d) => {
            combined.set(d.id, { ...(d.data() as RawMaterialPurchaseOrder), id: d.id });
          });
          const list = Array.from(combined.values()).sort((a, b) =>
            (b.createdAt || '').localeCompare(a.createdAt || '')
          );
          setPurchaseOrders(list);
          writeLocalCache(LS_RM_POS_KEY, list, false);
          setLoading(false);
        },
        () => setLoading(false)
      );
    } catch {
      setLoading(false);
    }

    const handleCustomUpdate = () => {
      setPurchaseOrders(readLocalCache<RawMaterialPurchaseOrder>(LS_RM_POS_KEY));
    };
    window.addEventListener(RAW_MATERIALS_UPDATED_EVENT, handleCustomUpdate);

    return () => {
      try {
        unsub();
      } catch {}
      window.removeEventListener(RAW_MATERIALS_UPDATED_EVENT, handleCustomUpdate);
    };
  }, []);

  return { purchaseOrders, pos: purchaseOrders, loading };
}

export async function saveRawMaterialPOInDb(
  po: Partial<RawMaterialPurchaseOrder> & { supplierName: string; items: RawMaterialPOItem[] }
): Promise<RawMaterialPurchaseOrder> {
  const now = new Date().toISOString();
  const id = sanitizeFirestoreDocId(po.id, 'POBB');
  const totalAmount = po.items.reduce(
    (sum, i) => sum + Number(i.subtotal || i.qty * i.buyPrice || 0),
    0
  );
  const paidAmount =
    po.paymentMethod === 'Hutang Tempo'
      ? Number(po.paidAmount ?? 0)
      : Number(po.paidAmount ?? totalAmount);
  const remainingDebt = Math.max(0, totalAmount - paidAmount);
  const paymentStatus: RawMaterialPurchaseOrder['paymentStatus'] =
    remainingDebt <= 0 ? 'Paid' : paidAmount > 0 ? 'Partial' : 'Unpaid';

  const record: RawMaterialPurchaseOrder = stripUndefined({
    id,
    storeId: ACTIVE_STORE_ID,
    poNumber:
      po.poNumber ||
      `PO-BB-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${id.slice(-4).toUpperCase()}`,
    supplierId: po.supplierId || '',
    supplierName: po.supplierName,
    orderDate: po.orderDate || now.slice(0, 10),
    expectedDate: po.expectedDate || now.slice(0, 10),
    receivedDate: po.receivedDate || '',
    status: po.status || 'Ordered',
    paymentStatus,
    paymentMethod: po.paymentMethod || 'Cash',
    items: po.items,
    totalAmount,
    paidAmount,
    remainingDebt,
    notes: po.notes || '',
    createdBy: po.createdBy || 'Admin Purchasing',
    createdAt: po.createdAt || now,
    updatedAt: now,
  });

  const cached = readLocalCache<RawMaterialPurchaseOrder>(LS_RM_POS_KEY);
  const exists = cached.some((c) => c.id === id);
  const nextCache = exists
    ? cached.map((c) => (c.id === id ? record : c))
    : [record, ...cached];
  writeLocalCache(LS_RM_POS_KEY, nextCache, true);

  try {
    await setDoc(doc(db, 'raw_material_purchase_orders', id), record, { merge: true });
  } catch {}
  emitRawMaterialsUpdated();
  return record;
}

/**
 * Receive a Raw Material Purchase Order (PO) into inventory (`raw_materials` + `raw_material_movements` + `cash_mutations`)
 */
export async function receiveRawMaterialPOInDb(
  po: RawMaterialPurchaseOrder,
  operator = 'Admin Gudang'
): Promise<void> {
  if (po.status === 'Received') return;
  const now = new Date().toISOString();

  for (const item of po.items) {
    await adjustRawMaterialStock({
      rawMaterialId: item.rawMaterialId,
      qtyDelta: Number(item.qty || 0),
      type: 'po_receive',
      referenceId: po.poNumber,
      batchCode: item.batchCode || `BATCH-${po.poNumber}`,
      productionDate: item.productionDate || now.slice(0, 10),
      expiryDate: item.expiryDate || '',
      newBuyPrice: Number(item.buyPrice || 0),
      supplierName: po.supplierName,
      notes: `Penerimaan PO Bahan Baku ${po.poNumber} dari ${po.supplierName}`,
      operator,
    });
  }

  const updatedPo: RawMaterialPurchaseOrder = {
    ...po,
    status: 'Received',
    receivedDate: now.slice(0, 10),
    updatedAt: now,
  };
  const cachedPos = readLocalCache<RawMaterialPurchaseOrder>(LS_RM_POS_KEY);
  writeLocalCache(
    LS_RM_POS_KEY,
    cachedPos.map((p) => (p.id === po.id ? updatedPo : p)),
    true
  );

  try {
    await setDoc(
      doc(db, 'raw_material_purchase_orders', po.id),
      {
        status: 'Received',
        receivedDate: now.slice(0, 10),
        updatedAt: now,
      },
      { merge: true }
    );
  } catch {}

  // Record financial cashflow outflow if paid
  if (po.paidAmount > 0) {
    const mutId = `CF-RMBB-${po.id}`;
    try {
      await setDoc(
        doc(db, 'cash_mutations', mutId),
        {
          id: mutId,
          storeId: ACTIVE_STORE_ID,
          type: 'out',
          category: 'Pembelian Bahan Baku',
          amount: po.paidAmount,
          description: `Pembayaran PO Bahan Baku ${po.poNumber} (${po.supplierName})`,
          paymentMethod: po.paymentMethod,
          referenceId: po.poNumber,
          createdAt: now,
        },
        { merge: true }
      );
    } catch {}
  }

  emitRawMaterialsUpdated();
}

/**
 * Live hook for Raw Material Purchase Requests (`raw_material_purchase_requests`)
 */
export function useRawMaterialPRs() {
  const [purchaseRequests, setPurchaseRequests] = useState<RawMaterialPurchaseRequest[]>(() =>
    readLocalCache<RawMaterialPurchaseRequest>(LS_RM_PRS_KEY)
  );
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let unsub = () => {};
    try {
      unsub = onSnapshot(
        collection(db, 'raw_material_purchase_requests'),
        (snap) => {
          const combined = new Map<string, RawMaterialPurchaseRequest>();
          readLocalCache<RawMaterialPurchaseRequest>(LS_RM_PRS_KEY).forEach((p) => {
            if (p?.id) combined.set(p.id, p);
          });
          snap.docs.forEach((d) => {
            combined.set(d.id, { ...(d.data() as RawMaterialPurchaseRequest), id: d.id });
          });
          const list = Array.from(combined.values()).sort((a, b) =>
            (b.createdAt || '').localeCompare(a.createdAt || '')
          );
          setPurchaseRequests(list);
          writeLocalCache(LS_RM_PRS_KEY, list, false);
          setLoading(false);
        },
        () => setLoading(false)
      );
    } catch {
      setLoading(false);
    }

    const handleCustomUpdate = () => {
      setPurchaseRequests(readLocalCache<RawMaterialPurchaseRequest>(LS_RM_PRS_KEY));
    };
    window.addEventListener(RAW_MATERIALS_UPDATED_EVENT, handleCustomUpdate);

    return () => {
      try {
        unsub();
      } catch {}
      window.removeEventListener(RAW_MATERIALS_UPDATED_EVENT, handleCustomUpdate);
    };
  }, []);

  return { purchaseRequests, loading };
}

export async function saveRawMaterialPRInDb(
  pr: Partial<RawMaterialPurchaseRequest> & { items: RawMaterialPurchaseRequest['items'] }
): Promise<RawMaterialPurchaseRequest> {
  const now = new Date().toISOString();
  const id = sanitizeFirestoreDocId(pr.id, 'PRBB');
  const totalEstimatedCost = pr.items.reduce(
    (sum, i) => sum + Number(i.subtotal || i.requestedQty * i.estimatedCost || 0),
    0
  );

  const record: RawMaterialPurchaseRequest = stripUndefined({
    id,
    storeId: ACTIVE_STORE_ID,
    prNumber:
      pr.prNumber ||
      `PR-BB-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${id.slice(-4).toUpperCase()}`,
    requestDate: pr.requestDate || now.slice(0, 10),
    requestedBy: pr.requestedBy || 'Tim Produksi / Gudang',
    urgency: pr.urgency || 'Normal',
    status: pr.status || 'Pending',
    supplierId: pr.supplierId || '',
    supplierName: pr.supplierName || 'Supplier Umum',
    items: pr.items,
    totalEstimatedCost,
    notes: pr.notes || '',
    linkedPoNumber: pr.linkedPoNumber || '',
    source: pr.source || 'Manual',
    createdAt: pr.createdAt || now,
    updatedAt: now,
  });

  const cached = readLocalCache<RawMaterialPurchaseRequest>(LS_RM_PRS_KEY);
  const exists = cached.some((c) => c.id === id);
  const nextCache = exists
    ? cached.map((c) => (c.id === id ? record : c))
    : [record, ...cached];
  writeLocalCache(LS_RM_PRS_KEY, nextCache, true);

  try {
    await setDoc(doc(db, 'raw_material_purchase_requests', id), record, { merge: true });
  } catch {}
  emitRawMaterialsUpdated();
  return record;
}

/**
 * Live hook for Raw Material Stock Movements (`raw_material_movements`)
 */
export function useRawMaterialMovements() {
  const [movements, setMovements] = useState<RawMaterialMovement[]>(() =>
    readLocalCache<RawMaterialMovement>(LS_RM_MOVEMENTS_KEY)
  );
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let unsub = () => {};
    try {
      unsub = onSnapshot(
        collection(db, 'raw_material_movements'),
        (snap) => {
          const combined = new Map<string, RawMaterialMovement>();
          readLocalCache<RawMaterialMovement>(LS_RM_MOVEMENTS_KEY).forEach((m) => {
            if (m?.id) combined.set(m.id, m);
          });
          snap.docs.forEach((d) => {
            combined.set(d.id, { ...(d.data() as RawMaterialMovement), id: d.id });
          });
          const list = Array.from(combined.values()).sort((a, b) =>
            (b.createdAt || '').localeCompare(a.createdAt || '')
          );
          setMovements(list);
          writeLocalCache(LS_RM_MOVEMENTS_KEY, list, false);
          setLoading(false);
        },
        () => setLoading(false)
      );
    } catch {
      setLoading(false);
    }

    const handleCustomUpdate = () => {
      setMovements(readLocalCache<RawMaterialMovement>(LS_RM_MOVEMENTS_KEY));
    };
    window.addEventListener(RAW_MATERIALS_UPDATED_EVENT, handleCustomUpdate);

    return () => {
      try {
        unsub();
      } catch {}
      window.removeEventListener(RAW_MATERIALS_UPDATED_EVENT, handleCustomUpdate);
    };
  }, []);

  return { movements, loading };
}
