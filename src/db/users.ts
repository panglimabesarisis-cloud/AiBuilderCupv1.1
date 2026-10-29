import { desc, inArray } from 'drizzle-orm';
import { db } from './index.ts';
import {
  users,
  entries,
  products,
  orders,
  transactions,
  aiMonitoringLogs,
  modalSafes,
} from './schema.ts';

export function isProtectedOwnerOrDemoAccount(record: any, docId?: string): boolean {
  if (!record || typeof record !== 'object') return false;
  const idStr = String(docId || record.uid || record.id || '').trim().toLowerCase();
  const emailStr = String(record.email || '').trim().toLowerCase();
  const roleStr = String(record.role || record.roleKey || '').trim().toLowerCase();
  const usernameStr = String(record.username || record.name || '').trim().toLowerCase();

  if (
    roleStr === 'owner' ||
    roleStr === 'super admin' ||
    roleStr === 'demo' ||
    record.isDemo === true ||
    record.isOwner === true ||
    idStr === 'staff_001' ||
    idStr === 'staff_demo' ||
    idStr.includes('owner') ||
    idStr.includes('demo') ||
    emailStr === 'owner@riskcart.ai' ||
    emailStr === 'panglimabesarisis@gmail.com' ||
    emailStr.includes('owner') ||
    emailStr.includes('demo') ||
    usernameStr.includes('owner') ||
    usernameStr.includes('demo')
  ) {
    return true;
  }
  return false;
}

export async function getOrCreateUser(uid: string, email: string) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database upsert failed for user:', error);
    throw new Error('Failed to synchronize user with database.', { cause: error });
  }
}

export async function getUsers() {
  try {
    return await db.select().from(users);
  } catch (error) {
    console.error('Database query failed:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function recordTransactionToSql(input: {
  transactionNumber: string;
  channel?: string;
  paymentMethod?: string;
  totalAmount: number;
  status?: string;
  cashierName?: string;
  customerName?: string;
  itemsSummary?: string;
  aiRiskLevel?: string;
  aiFraudScore?: number;
}) {
  try {
    const result = await db
      .insert(transactions)
      .values({
        transactionNumber: input.transactionNumber,
        channel: input.channel || 'pos',
        paymentMethod: input.paymentMethod || 'cash',
        totalAmount: Math.round(Number(input.totalAmount) || 0),
        status: input.status || 'completed',
        cashierName: input.cashierName || 'Cashier',
        customerName: input.customerName || null,
        itemsSummary: input.itemsSummary || '[]',
        aiRiskLevel: input.aiRiskLevel || 'clean',
        aiFraudScore: Math.round(Number(input.aiFraudScore) || 0),
      })
      .onConflictDoUpdate({
        target: transactions.transactionNumber,
        set: {
          status: input.status || 'completed',
          totalAmount: Math.round(Number(input.totalAmount) || 0),
          aiRiskLevel: input.aiRiskLevel || 'clean',
          aiFraudScore: Math.round(Number(input.aiFraudScore) || 0),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Failed to record transaction to Cloud SQL:', error);
    throw new Error('Database transaction write failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function getSqlTransactions(limitCount = 100) {
  try {
    return await db
      .select()
      .from(transactions)
      .orderBy(desc(transactions.createdAt))
      .limit(limitCount);
  } catch (error) {
    console.error('Failed to fetch transactions from Cloud SQL:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function recordAiMonitoringLogToSql(input: {
  agentKey: string;
  moduleName?: string;
  eventType?: string;
  riskLevel?: string;
  summary: string;
  latencyMs?: number;
}) {
  try {
    const result = await db
      .insert(aiMonitoringLogs)
      .values({
        agentKey: input.agentKey,
        moduleName: input.moduleName || 'AI Monitoring',
        eventType: input.eventType || 'INVOCATION',
        riskLevel: input.riskLevel || 'clean',
        summary: input.summary,
        latencyMs: Math.round(Number(input.latencyMs) || 0),
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Failed to record AI monitoring log to Cloud SQL:', error);
    throw new Error('Database AI log write failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function getSqlAiMonitoringLogs(limitCount = 100) {
  try {
    return await db
      .select()
      .from(aiMonitoringLogs)
      .orderBy(desc(aiMonitoringLogs.createdAt))
      .limit(limitCount);
  } catch (error) {
    console.error('Failed to fetch AI monitoring logs from Cloud SQL:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function resetDatabaseAllData(): Promise<{
  deletedUsers: number;
  tablesCleared: string[];
}> {
  const tablesCleared: string[] = [];
  let deletedUsers = 0;

  if (!process.env.SQL_HOST || !process.env.SQL_DB_NAME) {
    return { deletedUsers: 0, tablesCleared };
  }

  try {
    try {
      await db.delete(entries).catch(() => {});
      tablesCleared.push('entries');
    } catch {}
    try {
      await db.delete(orders).catch(() => {});
      tablesCleared.push('orders');
    } catch {}
    try {
      await db.delete(transactions).catch(() => {});
      tablesCleared.push('transactions');
    } catch {}
    try {
      await db.delete(aiMonitoringLogs).catch(() => {});
      tablesCleared.push('ai_monitoring_logs');
    } catch {}
    try {
      await db.delete(products).catch(() => {});
      tablesCleared.push('products');
    } catch {}
    try {
      await db.delete(modalSafes).catch(() => {});
      tablesCleared.push('modal_safes');
    } catch {}

    try {
      const allUsers = await db.select().from(users);
      const uidsToDelete = allUsers
        .filter((u: any) => !isProtectedOwnerOrDemoAccount(u, u.uid))
        .map((u: any) => u.uid);

      if (uidsToDelete.length > 0) {
        await db.delete(users).where(inArray(users.uid, uidsToDelete));
        deletedUsers = uidsToDelete.length;
      }
      tablesCleared.push('users');
    } catch {}
  } catch {}

  return { deletedUsers, tablesCleared };
}
