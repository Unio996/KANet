import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const FILE = './state/seen.json';
const MAX_SEEN = 10000;

export function loadSeen() {
  try {
    const data = JSON.parse(readFileSync(FILE, 'utf-8'));
    const trimmed = Array.isArray(data) ? data.slice(-MAX_SEEN) : [];
    return new Set(trimmed);
  } catch {
    return new Set();
  }
}

export function saveSeen(set) {
  let arr = [...set];
  if (arr.length > MAX_SEEN) arr = arr.slice(-MAX_SEEN);
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(arr));
  } catch (err) {
    console.error('[state] save error:', err.message);
  }
}
