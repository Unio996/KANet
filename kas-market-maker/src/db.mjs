/**
 * db.mjs — SQLite data layer for Market Maker
 * Tracks orders, quotes, and reputation.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const DB_PATH = resolve(import.meta.dirname, '..', 'data', 'mm.db');
const db = new Database(DB_PATH);

// WAL mode for concurrent read/write
db.pragma('journal_mode = WAL');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    side TEXT NOT NULL,
    kas_amount REAL NOT NULL,
    usdt_amount REAL NOT NULL,
    price REAL NOT NULL,
    chain TEXT NOT NULL,
    customer_kaspa_address TEXT,
    customer_pay_address TEXT,
    mm_receive_address TEXT,
    status TEXT NOT NULL DEFAULT 'quoted',
    payment_txhash TEXT,
    kas_txhash TEXT,
    batch_index INTEGER DEFAULT 0,
    batch_total INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY,
    buy_price REAL,
    sell_price REAL,
    kas_stock REAL,
    usdt_stock REAL,
    mexc_price REAL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    order_id TEXT,
    side TEXT NOT NULL,
    kas_amount REAL NOT NULL,
    onchain_price REAL NOT NULL,
    exchange_price REAL NOT NULL,
    profit_usdt REAL NOT NULL,
    exchange_order_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at);
`);

export function createOrder({ side, kasAmount, usdtAmount, price, chain, customerKaspaAddress, customerPayAddress, mmReceiveAddress, batchIndex, batchTotal }) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO orders (id, side, kas_amount, usdt_amount, price, chain, customer_kaspa_address, customer_pay_address, mm_receive_address, status, batch_index, batch_total, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'quoted', ?, ?, ?)
  `).run(id, side, kasAmount, usdtAmount, price, chain, customerKaspaAddress, customerPayAddress, mmReceiveAddress, batchIndex || 0, batchTotal || 1, now);
  return id;
}

export function updateOrderStatus(id, status, extra = {}) {
  const sets = ['status = ?'];
  const params = [status];
  if (extra.paymentTxhash) { sets.push('payment_txhash = ?'); params.push(extra.paymentTxhash); }
  if (extra.kasTxhash) { sets.push('kas_txhash = ?'); params.push(extra.kasTxhash); }
  if (status === 'completed') { sets.push('completed_at = ?'); params.push(new Date().toISOString()); }
  params.push(id);
  db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function getOrder(id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

export function getPendingOrders() {
  return db.prepare("SELECT * FROM orders WHERE status IN ('quoted', 'awaiting_payment', 'payment_verified') ORDER BY created_at").all();
}

export function recordQuote({ buyPrice, sellPrice, kasStock, usdtStock, mexcPrice }) {
  const id = randomUUID();
  db.prepare('INSERT INTO quotes (id, buy_price, sell_price, kas_stock, usdt_stock, mexc_price, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, buyPrice, sellPrice, kasStock, usdtStock, mexcPrice, new Date().toISOString());
}

export function getReputation() {
  return db.prepare(`
    SELECT
      COUNT(*) as total_orders,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'disputed' THEN 1 ELSE 0 END) as disputes,
      ROUND(SUM(kas_amount), 2) as total_kas_volume,
      MIN(created_at) as operating_since
    FROM orders
  `).get();
}

export function recordTrade({ orderId, side, kasAmount, onchainPrice, exchangePrice, exchangeOrderId }) {
  const id = randomUUID();
  const profit = side === 'sell'
    ? (onchainPrice - exchangePrice) * kasAmount   // MM sells on-chain at higher price, buys on exchange at lower
    : (exchangePrice - onchainPrice) * kasAmount;  // MM buys on-chain at lower price, sells on exchange at higher
  db.prepare('INSERT INTO trades (id, order_id, side, kas_amount, onchain_price, exchange_price, profit_usdt, exchange_order_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, orderId, side, kasAmount, onchainPrice, exchangePrice, parseFloat(profit.toFixed(4)), exchangeOrderId, new Date().toISOString());
  return { id, profit };
}

export function getPnL(days = 1) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return db.prepare(`
    SELECT
      COUNT(*) as trades,
      ROUND(SUM(kas_amount), 2) as volume_kas,
      ROUND(SUM(profit_usdt), 4) as total_profit,
      ROUND(AVG(profit_usdt), 4) as avg_profit,
      ROUND(MIN(profit_usdt), 4) as worst_trade,
      ROUND(MAX(profit_usdt), 4) as best_trade
    FROM trades WHERE created_at > ?
  `).get(since);
}

export function getRecentTrades(limit = 20) {
  return db.prepare('SELECT * FROM trades ORDER BY created_at DESC LIMIT ?').all(limit);
}

export { db };
