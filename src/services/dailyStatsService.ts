import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  increment,
  getAggregateFromServer,
  sum,
  count,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { db, isFirestoreQuotaExhausted, markFirestoreQuotaExhausted } from '../firebase';
import { ACTIVE_STORE_ID } from '../config/store';
import { Transaction } from '../types';

export interface DailyStatsSummary {
  id: string;
  storeId: string;
  dateKey: string; // YYYYMMDD
  orderDate: string; // YYYY-MM-DD
  txCount: number;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  itemsSold: number;
  cashRevenue: number;
  qrisRevenue: number;
  debtAmount: number;
  updatedAt: string;
}

const DAILY_STATS_LS_KEY = 'riskcart_daily_stats_v1';

export function getTodayDateYmd(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function toCompactDateKey(dateYmd?: string): string {
  const clean = (dateYmd || getTodayDateYmd()).slice(0, 10).replace(/[^0-9]/g, '');
  return clean.length === 8 ? clean : getTodayDateYmd().replace(/-/g, '');
}

export function getDailyStatsDocId(storeId = ACTIVE_STORE_ID, dateYmd?: string): string {
  return `${storeId}_${toCompactDateKey(dateYmd)}`;
}

function readLocalDailyStatsMap(): Record<string, DailyStatsSummary> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(DAILY_STATS_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalDailyStatsMap(map: Record<string, DailyStatsSummary>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DAILY_STATS_LS_KEY, JSON.stringify(map));
  } catch {}
}

/**
 * Updates `dailyStats/{storeId}_{YYYYMMDD}` atomically using Firestore `increment()`
 * whenever a transaction is saved, and updates the local mirror immediately.
 */
export async function recordTransactionInDailyStats(
  tx: Partial<Transaction> & Record<string, any>,
  storeId = ACTIVE_STORE_ID
): Promise<void> {
  if (!tx) return;
  const rawDate = String(tx.orderDate || tx.createdAt || tx.timestamp || getTodayDateYmd()).slice(0, 10);
  const orderDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : getTodayDateYmd();
  const dateKey = toCompactDateKey(orderDate);
  const docId = `${storeId}_${dateKey}`;

  const totalRevenue = Math.max(0, Number(tx.totalAmount ?? tx.total ?? 0));
  const totalCost = Math.max(0, Number(tx.totalCost ?? tx.totalModal ?? 0));
  const totalProfit = Number(tx.totalProfit ?? tx.keuntungan ?? Math.max(0, totalRevenue - totalCost));
  const itemsSold = Array.isArray(tx.items)
    ? tx.items.reduce(
        (acc: number, it: any) =>
          acc + Math.max(1, Number(it.quantityOrdered ?? it.qty ?? it.quantity ?? 1)),
        0
      )
    : Math.max(1, Number(tx.itemsCount || 1));

  const pm = String(tx.paymentMethod || 'cash').toLowerCase();
  const isCash = pm === 'cash' || pm === 'tunai';
  const isQris = pm === 'qris';
  const debtAmount = Math.max(0, Number(tx.remainingDebt ?? 0));
  const nowIso = new Date().toISOString();

  // 1. Update local cache mirror immediately
  const localMap = readLocalDailyStatsMap();
  const existing = localMap[docId] || {
    id: docId,
    storeId,
    dateKey,
    orderDate,
    txCount: 0,
    totalRevenue: 0,
    totalCost: 0,
    totalProfit: 0,
    itemsSold: 0,
    cashRevenue: 0,
    qrisRevenue: 0,
    debtAmount: 0,
    updatedAt: nowIso,
  };
  localMap[docId] = {
    ...existing,
    txCount: existing.txCount + 1,
    totalRevenue: existing.totalRevenue + totalRevenue,
    totalCost: existing.totalCost + totalCost,
    totalProfit: existing.totalProfit + totalProfit,
    itemsSold: existing.itemsSold + itemsSold,
    cashRevenue: existing.cashRevenue + (isCash ? totalRevenue : 0),
    qrisRevenue: existing.qrisRevenue + (isQris ? totalRevenue : 0),
    debtAmount: existing.debtAmount + debtAmount,
    updatedAt: nowIso,
  };
  writeLocalDailyStatsMap(localMap);

  if (isFirestoreQuotaExhausted()) return;

  // 2. Atomic server increment on `dailyStats/{storeId}_{YYYYMMDD}`
  try {
    await setDoc(
      doc(db, 'dailyStats', docId),
      {
        id: docId,
        storeId,
        dateKey,
        orderDate,
        txCount: increment(1),
        totalRevenue: increment(totalRevenue),
        totalCost: increment(totalCost),
        totalProfit: increment(totalProfit),
        itemsSold: increment(itemsSold),
        cashRevenue: increment(isCash ? totalRevenue : 0),
        qrisRevenue: increment(isQris ? totalRevenue : 0),
        debtAmount: increment(debtAmount),
        updatedAt: nowIso,
      },
      { merge: true }
    );
  } catch (err: any) {
    if (err?.code === 'resource-exhausted') {
      markFirestoreQuotaExhausted(true);
    }
  }
}

/**
 * Fetches Dashboard KPIs/totals from `dailyStats/{storeId}_{YYYYMMDD}` summary doc
 * with fallback to `getAggregateFromServer` (sum/count) — never full-collection reads.
 */
export async function fetchDashboardKpiSummary(
  storeId = ACTIVE_STORE_ID,
  dateYmd = getTodayDateYmd()
): Promise<DailyStatsSummary> {
  const dateKey = toCompactDateKey(dateYmd);
  const docId = `${storeId}_${dateKey}`;
  const localMap = readLocalDailyStatsMap();

  if (isFirestoreQuotaExhausted() && localMap[docId]) {
    return localMap[docId];
  }

  try {
    const snap = await getDoc(doc(db, 'dailyStats', docId));
    if (snap.exists()) {
      const d = snap.data() as any;
      const summary: DailyStatsSummary = {
        id: docId,
        storeId: d.storeId || storeId,
        dateKey: d.dateKey || dateKey,
        orderDate: d.orderDate || dateYmd,
        txCount: Number(d.txCount || 0),
        totalRevenue: Number(d.totalRevenue || 0),
        totalCost: Number(d.totalCost || 0),
        totalProfit: Number(d.totalProfit || 0),
        itemsSold: Number(d.itemsSold || 0),
        cashRevenue: Number(d.cashRevenue || 0),
        qrisRevenue: Number(d.qrisRevenue || 0),
        debtAmount: Number(d.debtAmount || 0),
        updatedAt: String(d.updatedAt || new Date().toISOString()),
      };
      localMap[docId] = summary;
      writeLocalDailyStatsMap(localMap);
      return summary;
    }

    // Fallback to server-side aggregation (getAggregateFromServer sum/count — 0 full document reads)
    const txQuery = query(
      collection(db, 'transactions'),
      where('storeId', '==', storeId),
      where('orderDate', '==', dateYmd)
    );
    const aggSnap = await getAggregateFromServer(txQuery, {
      txCount: count(),
      totalRevenue: sum('totalAmount'),
      totalCost: sum('totalCost'),
      totalProfit: sum('totalProfit'),
    });
    const aggData = aggSnap.data();
    const aggregated: DailyStatsSummary = {
      id: docId,
      storeId,
      dateKey,
      orderDate: dateYmd,
      txCount: Number(aggData.txCount || 0),
      totalRevenue: Number(aggData.totalRevenue || 0),
      totalCost: Number(aggData.totalCost || 0),
      totalProfit: Number(aggData.totalProfit || 0),
      itemsSold: 0,
      cashRevenue: 0,
      qrisRevenue: 0,
      debtAmount: 0,
      updatedAt: new Date().toISOString(),
    };
    localMap[docId] = aggregated;
    writeLocalDailyStatsMap(localMap);
    return aggregated;
  } catch (err: any) {
    if (err?.code === 'resource-exhausted') {
      markFirestoreQuotaExhausted(true);
    }
    return (
      localMap[docId] || {
        id: docId,
        storeId,
        dateKey,
        orderDate: dateYmd,
        txCount: 0,
        totalRevenue: 0,
        totalCost: 0,
        totalProfit: 0,
        itemsSold: 0,
        cashRevenue: 0,
        qrisRevenue: 0,
        debtAmount: 0,
        updatedAt: new Date().toISOString(),
      }
    );
  }
}

/**
 * Builds compact model context for AI Chart / AI Advisor / AI Agents strictly from `dailyStats` summary docs,
 * never by reading all transactions or products.
 */
export async function fetchDailyStatsForAiContext(
  storeId = ACTIVE_STORE_ID,
  daysLimit = 7
): Promise<{
  storeId: string;
  generatedAt: string;
  dailySummaries: DailyStatsSummary[];
  totals: {
    txCount: number;
    totalRevenue: number;
    totalCost: number;
    totalProfit: number;
    itemsSold: number;
  };
}> {
  const localMap = readLocalDailyStatsMap();
  let summaries: DailyStatsSummary[] = Object.values(localMap)
    .filter((s) => s.storeId === storeId)
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
    .slice(0, daysLimit);

  if (!isFirestoreQuotaExhausted()) {
    try {
      const q = query(
        collection(db, 'dailyStats'),
        where('storeId', '==', storeId),
        limit(daysLimit)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const fetched: DailyStatsSummary[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            storeId: data.storeId || storeId,
            dateKey: String(data.dateKey || d.id.split('_').pop() || ''),
            orderDate: String(data.orderDate || ''),
            txCount: Number(data.txCount || 0),
            totalRevenue: Number(data.totalRevenue || 0),
            totalCost: Number(data.totalCost || 0),
            totalProfit: Number(data.totalProfit || 0),
            itemsSold: Number(data.itemsSold || 0),
            cashRevenue: Number(data.cashRevenue || 0),
            qrisRevenue: Number(data.qrisRevenue || 0),
            debtAmount: Number(data.debtAmount || 0),
            updatedAt: String(data.updatedAt || ''),
          };
        });
        fetched.forEach((s) => {
          localMap[s.id] = s;
        });
        writeLocalDailyStatsMap(localMap);
        summaries = fetched.sort((a, b) => b.dateKey.localeCompare(a.dateKey)).slice(0, daysLimit);
      }
    } catch (err: any) {
      if (err?.code === 'resource-exhausted') {
        markFirestoreQuotaExhausted(true);
      }
    }
  }

  const totals = summaries.reduce(
    (acc, s) => ({
      txCount: acc.txCount + s.txCount,
      totalRevenue: acc.totalRevenue + s.totalRevenue,
      totalCost: acc.totalCost + s.totalCost,
      totalProfit: acc.totalProfit + s.totalProfit,
      itemsSold: acc.itemsSold + s.itemsSold,
    }),
    { txCount: 0, totalRevenue: 0, totalCost: 0, totalProfit: 0, itemsSold: 0 }
  );

  return {
    storeId,
    generatedAt: new Date().toISOString(),
    dailySummaries: summaries,
    totals,
  };
}

/**
 * Cursor-based transaction history pagination using `getDocs` + `limit(50)` + `startAfter(cursor)` (no offset).
 */
export async function fetchTransactionsHistoryPage(params: {
  storeId?: string;
  cursorDoc?: QueryDocumentSnapshot<DocumentData> | null;
  pageSize?: number;
}): Promise<{
  items: Transaction[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}> {
  const storeId = params.storeId || ACTIVE_STORE_ID;
  const pageSize = Math.min(50, Math.max(1, params.pageSize || 50));

  if (isFirestoreQuotaExhausted()) {
    return { items: [], lastDoc: null, hasMore: false };
  }

  try {
    const baseConstraints: any[] = [
      where('storeId', '==', storeId),
      orderBy('createdAt', 'desc'),
      ...(params.cursorDoc ? [startAfter(params.cursorDoc)] : []),
      limit(pageSize),
    ];
    const q = query(collection(db, 'transactions'), ...baseConstraints);
    const snap = await getDocs(q);
    const items = snap.docs.map(
      (d) =>
        ({
          id: d.id,
          ...d.data(),
        } as Transaction)
    );
    const lastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
    return {
      items,
      lastDoc,
      hasMore: snap.docs.length === pageSize,
    };
  } catch (err: any) {
    if (err?.code === 'resource-exhausted') {
      markFirestoreQuotaExhausted(true);
    }
    return { items: [], lastDoc: null, hasMore: false };
  }
}
