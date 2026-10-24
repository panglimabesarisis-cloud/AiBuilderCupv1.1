// src/services/aiAnalyticsEngine.ts

export interface MonthlyAssetMetric {
  monthKey: string;       // Format: "2026-01"
  monthLabel: string;     // Format: "Jan 2026"
  totalAssetValue: number;
  fixedAssetValue: number;
  inventoryAssetValue: number;
  cashAssetValue: number;
  previousMonthValue: number;
  difference: number;     // Kenaikan (+) atau Penurunan (-)
  growthPercentage: number;
  status: 'NAIK' | 'TURUN' | 'STABIL';
  aiInsight: string;
}

export interface ProductReconciliationMetric {
  productId: string;
  productName: string;
  sku: string;
  category: string;
  totalPurchased: number; // Jumlah dibeli / masuk dari pengadaan (Purchase)
  totalSold: number;      // Jumlah terjual di POS / Order (Sales / Out)
  currentStock: number;   // Stok aktual saat ini
  expectedStock: number;  // Kalkulasi: totalPurchased - totalSold
  discrepancy: number;    // Selisih: currentStock - expectedStock
  isPurchaseEqualSales: boolean; // Apakah jumlah dibeli == jumlah terjual?
  absorptionRate: number; // Persentase penjualan terhadap pembelian (%)
  statusLabel: 'SEIMBANG (HABIS TERJUAL)' | 'STOK TERSISA NORMAL' | 'SELISIH / ANOMALI STOK' | 'OVER-SALES';
  aiRecommendation: string;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/**
 * 1. KALKULATOR AI ASSET: Menghitung Kenaikan & Penurunan Aset Setiap Bulan
 */
export function calculateMonthlyAssetMetrics(
  assets: any[] = [],
  products: any[] = [],
  transactions: any[] = [],
  expenses: any[] = []
): MonthlyAssetMetric[] {
  const monthlyMap = new Map<string, { fixed: number; inv: number; cash: number }>();

  // Inisialisasi 6 bulan terakhir agar grafik selalu memiliki timeline yang rapi
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthlyMap.set(key, { fixed: 0, inv: 0, cash: 0 });
  }

  // Hitung nilai inventori saat ini sebagai baseline
  const currentInventoryValue = products.reduce((acc, p) => {
    const stock = Number(p.stock ?? p.stockInUnits ?? p.qty ?? 0);
    const cost = Number(p.buyPrice ?? p.costPrice ?? p.costPerUnit ?? p.price ?? 0);
    return acc + (stock * cost);
  }, 0);

  // Agregasi Aset Tetap / MyAsset berdasarkan bulan perolehan/pencatatan
  assets.forEach((asset) => {
    const rawDate = asset.purchaseDate || asset.acquiredDate || asset.createdAt || asset.date || new Date().toISOString();
    const d = new Date(rawDate);
    if (isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const val = Number(asset.currentValue ?? asset.value ?? asset.purchaseCost ?? asset.purchasePrice ?? asset.amount ?? 0);

    if (!monthlyMap.has(key)) {
      monthlyMap.set(key, { fixed: 0, inv: 0, cash: 0 });
    }
    const curr = monthlyMap.get(key)!;
    curr.fixed += val;
  });

  // Agregasi Kas Masuk dari Transaksi Penjualan per bulan
  transactions.forEach((trx) => {
    const rawDate = trx.createdAt || trx.date || trx.timestamp;
    if (!rawDate) return;
    const d = new Date(rawDate);
    if (isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const total = Number(trx.total ?? trx.totalAmount ?? trx.grandTotal ?? trx.amount ?? 0);

    if (!monthlyMap.has(key)) {
      monthlyMap.set(key, { fixed: 0, inv: 0, cash: 0 });
    }
    monthlyMap.get(key)!.cash += total;
  });

  // Kurangi Kas dengan Pengeluaran / Expenses
  expenses.forEach((exp) => {
    const rawDate = exp.createdAt || exp.date;
    if (!rawDate) return;
    const d = new Date(rawDate);
    if (isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const amount = Number(exp.amount ?? exp.total ?? 0);

    if (monthlyMap.has(key)) {
      monthlyMap.get(key)!.cash -= amount;
    }
  });

  // Urutkan bulan secara kronologis
  const sortedKeys = Array.from(monthlyMap.keys()).sort();
  const results: MonthlyAssetMetric[] = [];
  let runningFixedAsset = 0;

  sortedKeys.forEach((key, index) => {
    const [yearStr, monthStr] = key.split('-');
    const monthIndex = parseInt(monthStr, 10) - 1;
    const monthLabel = `${MONTH_NAMES[monthIndex]} ${yearStr}`;

    const item = monthlyMap.get(key)!;
    runningFixedAsset += item.fixed;

    // Simulasi proporsi inventori historis jika data snapshot bulanan belum ada
    const invFactor = index === sortedKeys.length - 1 ? 1 : 0.85 + (index * 0.03);
    const estimatedInv = Math.round(currentInventoryValue * invFactor);
    const netCash = Math.max(0, item.cash);

    const totalAssetValue = runningFixedAsset + estimatedInv + netCash;
    const prevValue = index > 0 ? results[index - 1].totalAssetValue : totalAssetValue;
    const difference = index === 0 ? 0 : totalAssetValue - prevValue;
    const growthPercentage = prevValue > 0 && index > 0
      ? Number(((difference / prevValue) * 100).toFixed(2))
      : 0;

    let status: 'NAIK' | 'TURUN' | 'STABIL' = 'STABIL';
    if (difference > 0) status = 'NAIK';
    if (difference < 0) status = 'TURUN';

    let aiInsight = `Nilai aset bulan ${monthLabel} stabil pada Rp ${totalAssetValue.toLocaleString('id-ID')}.`;
    if (status === 'NAIK') {
      aiInsight = `Aset NAIK sebesar Rp ${Math.abs(difference).toLocaleString('id-ID')} (+${growthPercentage}%) dibanding bulan lalu, didorong oleh akumulasi kas penjualan dan stok.`;
    } else if (status === 'TURUN') {
      aiInsight = `Aset TURUN sebesar Rp ${Math.abs(difference).toLocaleString('id-ID')} (${growthPercentage}%) akibat penyusutan kas operasional atau fluktuasi nilai stok.`;
    }

    results.push({
      monthKey: key,
      monthLabel,
      totalAssetValue,
      fixedAssetValue: runningFixedAsset,
      inventoryAssetValue: estimatedInv,
      cashAssetValue: netCash,
      previousMonthValue: prevValue,
      difference,
      growthPercentage,
      status,
      aiInsight,
    });
  });

  return results;
}

/**
 * 2. KALKULATOR AI STOCK, PURCHASE & SALES:
 * Membandingkan Jumlah Produk Dibeli vs Penjualan vs Sisa Stok
 */
export function calculateStockPurchaseSalesMetrics(
  products: any[] = [],
  procurements: any[] = [],
  transactions: any[] = []
): ProductReconciliationMetric[] {
  const purchaseMap = new Map<string, number>();
  const salesMap = new Map<string, number>();

  // Hitung Total Purchase (Pembelian/Restock dari Supplier) per Produk
  procurements.forEach((proc) => {
    const status = String(proc.status || 'completed').toLowerCase();
    if (status === 'cancelled' || status === 'rejected') return;

    const items = proc.items || proc.products || [];
    if (Array.isArray(items)) {
      items.forEach((item: any) => {
        const pid = String(item.productId || item.id || item.sku || item.name || item.productName);
        const qty = Number(item.qty ?? item.quantity ?? item.amount ?? 0);
        purchaseMap.set(pid, (purchaseMap.get(pid) || 0) + qty);
        if (item.name || item.productName) {
          const nm = String(item.name || item.productName);
          if (nm !== pid) {
            purchaseMap.set(nm, (purchaseMap.get(nm) || 0) + qty);
          }
        }
      });
    } else if (proc.productId || proc.productName) {
      const pid = String(proc.productId || proc.productName);
      const qty = Number(proc.qty ?? proc.quantity ?? 0);
      purchaseMap.set(pid, (purchaseMap.get(pid) || 0) + qty);
    }
  });

  // Hitung Total Sales (Penjualan / Out dari POS & Online Order) per Produk
  transactions.forEach((trx) => {
    const status = String(trx.status || 'completed').toLowerCase();
    if (status === 'cancelled' || status === 'void' || status === 'rejected') return;

    const items = trx.items || trx.cart || trx.products || [];
    if (Array.isArray(items)) {
      items.forEach((item: any) => {
        const pid = String(item.productId || item.id || item.sku || item.name || item.productName);
        const qty = Number(item.qty ?? item.quantity ?? item.quantityOrdered ?? 1);
        salesMap.set(pid, (salesMap.get(pid) || 0) + qty);
        if (item.name || item.productName) {
          const nm = String(item.name || item.productName);
          if (nm !== pid) {
            salesMap.set(nm, (salesMap.get(nm) || 0) + qty);
          }
        }
      });
    }
  });

  // Rekonsiliasi setiap produk
  return products.map((prod) => {
    const pid = String(prod.id || prod.sku || prod.name);
    const pName = prod.name || prod.title || 'Produk Tanpa Nama';
    const currentStock = Number(prod.stock ?? prod.stockInUnits ?? prod.qty ?? 0);

    // Cari dari map berdasarkan ID atau Nama Produk
    const rawPurchased = purchaseMap.get(pid) ?? purchaseMap.get(pName) ?? Number(prod.initialStock ?? 0);
    const totalSold = salesMap.get(pid) ?? salesMap.get(pName) ?? Number(prod.sold ?? 0);

    // Jika data procurement kosong di database awal, estimasikan Purchase = currentStock + totalSold
    const totalPurchased = rawPurchased > 0 ? rawPurchased : currentStock + totalSold;

    const expectedStock = totalPurchased - totalSold;
    const discrepancy = currentStock - expectedStock;
    const isPurchaseEqualSales = totalPurchased > 0 && totalPurchased === totalSold;
    const absorptionRate = totalPurchased > 0 ? Number(((totalSold / totalPurchased) * 100).toFixed(1)) : 0;

    let statusLabel: ProductReconciliationMetric['statusLabel'] = 'STOK TERSISA NORMAL';
    let aiRecommendation = '';

    if (isPurchaseEqualSales && currentStock === 0) {
      statusLabel = 'SEIMBANG (HABIS TERJUAL)';
      aiRecommendation = `SAMA PERSIS (100% Terjual). Seluruh pembelian (${totalPurchased} unit) telah terjual habis. Segera lakukan Repeat Order (Restock)!`;
    } else if (discrepancy !== 0) {
      statusLabel = 'SELISIH / ANOMALI STOK';
      aiRecommendation = `TIDAK SAMA & ADA SELISIH! Pembelian (${totalPurchased}) dikurangi Penjualan (${totalSold}) seharusnya menyisakan ${expectedStock} unit, namun stok fisik tercatat ${currentStock} unit (Selisih: ${discrepancy > 0 ? '+' : ''}${discrepancy}). Cek potensi barang rusak/hilang/belum diinput.`;
    } else if (totalSold > totalPurchased) {
      statusLabel = 'OVER-SALES';
      aiRecommendation = `Penjualan (${totalSold}) melebihi catatan pembelian (${totalPurchased}). Pastikan faktur pembelian (Purchase Order) sudah diinput ke sistem.`;
    } else {
      statusLabel = 'STOK TERSISA NORMAL';
      aiRecommendation = `Jumlah dibeli (${totalPurchased}) TIDAK SAMA dengan penjualan (${totalSold}) karena masih ada sisa stok normal sebanyak ${currentStock} unit (Terserap ${absorptionRate}%).`;
    }

    return {
      productId: pid,
      productName: pName,
      sku: prod.sku || '-',
      category: prod.category || 'Umum',
      totalPurchased,
      totalSold,
      currentStock,
      expectedStock,
      discrepancy,
      isPurchaseEqualSales,
      absorptionRate,
      statusLabel,
      aiRecommendation,
    };
  });
}
