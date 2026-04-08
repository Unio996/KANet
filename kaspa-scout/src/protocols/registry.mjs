/**
 * Protocol detector registry.
 * Auto-discovers and loads all protocol detectors.
 */
import { KasiaDetector } from './kasia/detector.mjs';

const detectors = [];

export function registerDetector(detector) {
  detectors.push(detector);
  console.log(`[registry] registered: ${detector.name} v${detector.version}`);
}

export function getDetectors() {
  return detectors;
}

/**
 * Initialize all built-in protocol detectors.
 */
export function initDetectors() {
  registerDetector(new KasiaDetector());
}
