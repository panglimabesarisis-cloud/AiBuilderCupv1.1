import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

// Users table authenticated via Firebase Auth
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Entries table
export const entries = pgTable('entries', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  content: text('content').notNull(),
  date: text('date').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Products table for retail & wholesale catalog
export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  sku: text('sku').notNull(),
  category: text('category').notNull(),
  price: integer('price').notNull(),
  stock: integer('stock').notNull(),
  unit: text('unit').default('pcs'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Orders table
export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  orderNumber: text('order_number').notNull().unique(),
  channel: text('channel').notNull(),
  totalAmount: integer('total_amount').notNull(),
  status: text('status').notNull().default('completed'),
  customerPhone: text('customer_phone'),
  createdAt: timestamp('created_at').defaultNow(),
});

// POS & PWA Transactions ledger table (ensuring every transaction is recorded in Cloud SQL)
export const transactions = pgTable('transactions', {
  id: serial('id').primaryKey(),
  transactionNumber: text('transaction_number').notNull().unique(),
  channel: text('channel').notNull().default('pos'),
  paymentMethod: text('payment_method').notNull().default('cash'),
  totalAmount: integer('total_amount').notNull(),
  status: text('status').notNull().default('completed'),
  cashierName: text('cashier_name').notNull().default('Cashier'),
  customerName: text('customer_name'),
  itemsSummary: text('items_summary').notNull().default('[]'),
  aiRiskLevel: text('ai_risk_level').notNull().default('clean'),
  aiFraudScore: integer('ai_fraud_score').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

// AI Monitoring & Anomaly Detection logs table
export const aiMonitoringLogs = pgTable('ai_monitoring_logs', {
  id: serial('id').primaryKey(),
  agentKey: text('agent_key').notNull(),
  moduleName: text('module_name').notNull().default('AI Monitoring'),
  eventType: text('event_type').notNull().default('INVOCATION'),
  riskLevel: text('risk_level').notNull().default('clean'),
  summary: text('summary').notNull(),
  latencyMs: integer('latency_ms').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

// Modal Safe (Brangkas Modal) records
export const modalSafes = pgTable('modal_safes', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(), // 'in' or 'out'
  amount: integer('amount').notNull(),
  notes: text('notes').notNull(),
  cashier: text('cashier').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Relationships
export const usersRelations = relations(users, ({ many }) => ({
  entries: many(entries),
}));

export const entriesRelations = relations(entries, ({ one }) => ({
  author: one(users, {
    fields: [entries.userId],
    references: [users.id],
  }),
}));
