export type TransactionStatus = 'completed' | 'flagged_fraud' | 'pending_approval' | 'pending' | 'rejected' | 'refunded' | 'void' | 'cancelled';
export type PaymentMethod = 'cash' | 'qris' | 'card' | 'bank_transfer' | 'debt' | 'cod';
export type TransactionChannel = 'pos' | 'pwa_client' | 'offline_pos' | 'client_pwa' | 'pwa';
export type RiskSeverity = 'clean' | 'low' | 'medium' | 'high' | 'critical' | 'warning';
export type PackageType = 'carton' | 'unit';

export interface StoreConfig {
  id: string;
  name: string;
  ownerEmail: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
  fraudThresholdScore: number; // e.g. 60
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductBatchItem {
  batchCode: string;
  productionDate: string;
  expiryDate: string;
  qty: number;
  initialQty?: number;
  buyPrice: number;
  supplier?: string;
  poNumber?: string;
  receivedAt?: string;
}

export interface RawMaterialRecipeItem {
  rawMaterialId: string;
  rawMaterialName: string;
  rawMaterialSku?: string;
  unit: string;
  qtyPerUnit: number; // quantity of raw material consumed per 1 product/carton
  costPerUnit: number; // cost per 1 unit of raw material
  subtotalCost: number; // qtyPerUnit * costPerUnit
  wastagePercent?: number; // optional wastage allowance percentage
  notes?: string;
}

export interface Product {
  id: string;
  storeId: string;
  name: string;
  sku: string;
  category: string;
  barcode: string;
  piecesPerCarton: number; // e.g. 40 pcs per dus
  stockInUnits: number; // total units currently in stock
  costPerUnit: number; // COGS
  pricePerUnit: number; // retail price
  pricePerCarton: number; // wholesale price for whole carton
  minStockAlert: number;
  minStock?: number;
  cartonWholesalePrice?: number;
  imageUrl?: string;
  galleryUrls?: string[];
  galleryImages?: string[];
  storageLocation?: string;
  shelfLocation?: string;
  brand?: string;
  isActive?: boolean;
  isPosVisible?: boolean;
  isPwaVisible?: boolean;
  posPrice?: number;
  pwaPrice?: number;
  weightMl?: number;
  beratPerItem?: number;
  isiPerDus?: number;
  totalBeratKg?: number;
  deliveryCommission?: number;
  trackStockCard?: boolean;
  sellByUnit?: boolean;
  hasRawMaterials?: boolean;
  autoDeductRawMaterial?: boolean;
  rawMaterialRecipe?: RawMaterialRecipeItem[];
  mainUnit?: string;
  subUnit?: string;
  costPerCarton?: number;
  costPrice?: number;
  buyPrice?: number;
  modal?: number;
  variantType?: string;
  variantName?: string;
  variantGroupId?: string;
  groupName?: string;
  productionDate?: string;
  tanggalProduksi?: string;
  expiryDate?: string;
  tanggalKadaluarsa?: string;
  batches?: ProductBatchItem[];
  createdAt?: string;
  updatedAt?: string;
}

export interface TransactionItem {
  id: string;
  storeId: string;
  transactionId: string;
  productId: string;
  productName: string;
  name?: string;
  sku?: string;
  packageType: PackageType;
  quantityOrdered: number;
  qty?: number;
  quantity?: number;
  unitsDeducted: number;
  unitPrice: number;
  unitCost?: number;
  costPrice?: number;
  buyPrice?: number;
  modal?: number;
  subtotal: number;
  profit?: number;
  batchCode?: string;
  fefoBatchesUsed?: Array<{
    batchCode: string;
    deductedQty: number;
    expiryDate?: string;
    productionDate?: string;
  }>;
}

export interface Transaction {
  id: string;
  storeId: string;
  outletId?: string;
  channel: TransactionChannel;
  customerName: string;
  customerPhone?: string;
  totalAmount: number;
  totalCost: number;
  totalProfit?: number;
  modal?: number;
  subtotal?: number;
  tax?: number;
  discount?: number;
  paymentMethod: PaymentMethod;
  status: TransactionStatus;
  fulfillmentStatus?: 'pending' | 'processing' | 'ready' | 'completed';
  fraudScore: number; // 0 - 100
  fraudFlags: string[];
  riskLevel: RiskSeverity;
  riskScore?: number;
  cartonBreakdown?: string;
  customerLatitude?: number;
  customerLongitude?: number;
  distanceToStoreMeters?: number;
  gpsAccuracy?: number;
  isMockGpsSuspected?: boolean;
  aiExplanation?: string;
  cashierId?: string;
  cashierName?: string;
  cashierRole?: string;
  cashierEmail?: string;
  shiftId?: string;
  items?: TransactionItem[];
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface FraudLog {
  id: string;
  storeId: string;
  transactionId: string;
  riskLevel: RiskSeverity;
  anomalyType: string;
  summary: string;
  aiDetails: string;
  resolved: boolean;
  timestamp: string;
}

export interface RestockRecommendation {
  id: string;
  storeId: string;
  productId: string;
  productName: string;
  currentStockUnits: number;
  piecesPerCarton: number;
  suggestedCartons: number;
  estimatedCost: number;
  urgency: 'urgent' | 'medium' | 'optimal';
  aiRationale: string;
  createdAt: string;
}

export interface CartItem {
  product: Product;
  packageType: PackageType;
  quantity: number;
}

export interface BundleItem {
  productId: string;
  productName: string;
  sku?: string;
  qty: number;
  promoPrice: number;
  costPrice: number;
  sellingPrice: number;
  discount: number;
  unit?: string;
}

export interface ProductBundle {
  id?: string;
  storeId: string;
  bundleCode: string;
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  quota: number;
  soldCount?: number;
  items: BundleItem[];
  totalCostPrice: number;
  totalStandardPrice: number;
  totalPromoPrice: number;
  totalDiscount: number;
  bundleProfit: number;
  status: 'active' | 'expired' | 'deactivated';
  createdAt?: string;
  updatedAt?: string;
}

export interface CustomerType {
  id?: string;
  storeId: string;
  name: string; // e.g. "UMUM", "MEMBER VIP PWA", "WHOLESALE / GROSIR"
  code: string; // e.g. "CUST-VIP", "CUST-WHL"
  discountRate: number; // e.g. 5 for 5%
  pointMultiplier: number; // e.g. 2 for 2x or 200%
  minMonthlySpend?: number; // e.g. 1000000
  description?: string;
  status: 'active' | 'inactive';
  benefits?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CustomerItem {
  id: string;
  storeId?: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  type: string; // matches CustomerType name or code
  typeCode?: string;
  creditLimit: number;
  points: number;
  debtAmount: number;
  debtAgeDays?: number;
  subscriptionPlan?: string;
  totalSpent: number;
  totalOrders?: number;
  joinedDate?: string;
  lastTransactionDate?: string;
  status: 'active' | 'inactive';
  createdAt?: string;
  updatedAt?: string;
}

export interface DiscountPriceRule {
  id?: string;
  storeId: string;
  productId: string;
  productName: string;
  productSku?: string;
  customerTypeId: string;
  customerTypeName: string; // e.g. "UMUM", "MEMBER", "VIP", "WHOLESALE"
  customerTypeCode?: string;
  normalPrice: number;
  costPrice: number;
  discountPrice: number;
  minQty: number; // minimum quantity threshold
  marginProfit: number; // discountPrice - costPrice
  pointPercent: number; // percentage of profit allocated as points
  pointsReward: number; // calculated points reward per unit
  status: 'active' | 'inactive';
  createdAt?: string;
  updatedAt?: string;
}

export type OrderStatus =
  | 'new'
  | 'packing'
  | 'shipped'
  | 'delivered'
  | 'returned'
  | 'cancelled'
  | 'New'
  | 'Sedang Mengemas'
  | 'Dikirim'
  | 'Terkirim';
export type OrderChannel = 'visitor' | 'pwa' | 'website' | 'pos';

export interface OrderItem {
  id?: string;
  productId: string;
  name: string;
  sku: string;
  packageType: 'carton' | 'unit';
  qty: number;
  costPrice: number;
  sellingPrice: number;
  subtotal: number;
  profit?: number;
}

export interface OrderPaymentRecord {
  id: string;
  date: string;
  amount: number;
  method: string;
  note?: string;
  recordedBy?: string;
}

export interface Order {
  id: string;
  storeId?: string;
  orderNumber: string; // e.g. NL-3062 / ORD-2026-001
  customerId?: string | null;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  channel: OrderChannel;
  itemsCount: number;
  items: OrderItem[];
  totalCost: number; // Total Modal (COGS)
  totalAmount: number; // Total Jual
  totalProfit: number; // Total Untung (totalAmount - totalCost)
  status: OrderStatus;
  paymentMethod: string;
  paymentStatus: 'paid' | 'unpaid' | 'partial' | 'pending' | 'hutang' | 'lunas';
  paidAmount?: number;
  remainingDebt?: number;
  dueDate?: string | null;
  paidAt?: string | null;
  paymentHistory?: OrderPaymentRecord[];
  deliveryStaffId?: string | null;
  deliveryStaffName?: string | null;
  deliveryStaffRole?: string | null;
  deliveryStaffPhone?: string | null;
  deliveryCommission?: number;
  assignedAt?: string | null;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

