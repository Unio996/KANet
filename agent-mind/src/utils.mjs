/**
 * Shared utilities for agent-mind.
 * No external dependencies — uses only Node built-ins + global fetch.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const FETCH_TIMEOUT = 10_000;      // 10s for Console/Scout API
const BRAIN_TIMEOUT = 180_000;     // 180s for AI Brain (large context needs time)

/**
 * Fetch JSON from a URL with timeout.
 * Supports GET (default) and POST (pass options with method/body).
 * Pass options.brainCall = true for extended timeout (AI inference).
 */
export async function fetchJson(url, options = {}) {
  const timeout = options.brainCall ? BRAIN_TIMEOUT : FETCH_TIMEOUT;
  delete options.brainCall;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      if (res.status !== 404) console.log(`[fetchJson] ${res.status} from ${url}: ${errBody.slice(0, 200)}`);
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${errBody.slice(0, 100)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Read a JSON file, returns null if not found or invalid.
 */
export async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write a JSON file, creating parent directories if needed.
 */
export async function writeJsonFile(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Sleep for ms milliseconds.
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
