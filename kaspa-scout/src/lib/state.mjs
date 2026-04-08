/**
 * Scan progress persistence.
 * Saves detector state to data/scout-state.json.
 * Survives restarts — each detector picks up where it left off.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(__dirname, '..', '..', 'data', 'scout-state.json');

let state = {};

export function loadState() {
  try {
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    const raw = readFileSync(STATE_PATH, 'utf-8');
    state = JSON.parse(raw);
    console.log('[state] loaded from', STATE_PATH);
  } catch {
    state = {};
    console.log('[state] starting fresh');
  }
  return state;
}

export function saveState() {
  try {
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[state] save error:', err.message);
  }
}

export function getState() {
  return state;
}
