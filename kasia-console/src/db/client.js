// Creates and exports the drizzle DB instance
// Uses DB_PATH from env, defaults to ./data/console.db
// Ensures the data directory exists
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

const dbPath = resolve(process.env.DB_PATH || './data/console.db');
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { sqlite, dbPath };
