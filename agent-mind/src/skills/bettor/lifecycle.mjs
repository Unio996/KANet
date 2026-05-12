/**
 * Market Lifecycle State Machine — Phase 3f-1 Sub #4 (Bettor r55 architect spec).
 *
 * 7-state classifier on (market.end_date + event_calendar 最近事件 vs now). Drives
 * scanner/reactor (Sub #5) 决策: priced_in / just_ended / event_live SKIP scan
 * (LLM 估值波动期不可信), pre_event_near 减半仓位 (建仓但等事件信号), pre_event_far
 * 标准流程. Owner 5/12 钦定 "利好出尽不入场".
 *
 * Pure function — no LLM, no DB, no network. caller (scanner/reactor) lookup
 * event_calendar 表传 input.
 */

export const LIFECYCLE_STATES = Object.freeze([
  'pre_event_far',
  'pre_event_near',
  'event_imminent',
  'event_live',
  'just_ended',
  'priced_in',
  'resolved',
]);

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const IMMINENT_WINDOW_MS = 30 * 60 * 1000;        // 30min pre-event = imminent
const LIVE_WINDOW_MS = 2 * MS_PER_HOUR;           // ±2h around event = live
const JUST_ENDED_WINDOW_MS = 30 * 60 * 1000;      // 30min after live ends = just_ended
const PRICED_IN_WINDOW_MS = 6 * MS_PER_HOUR;      // up to 6h after live ends = priced_in
const PRE_NEAR_WINDOW_MS = 7 * MS_PER_DAY;        // within 7d of first future event = pre_near

/**
 * Compute lifecycle state for a prediction market.
 *
 * Precedence (top-to-bottom, first match wins):
 *   1. market.end_date passed → 'resolved' (terminal)
 *   2. nearest past event within live + tail (just_ended / priced_in) window → those states
 *   3. nearest future event determines: imminent / live / pre_near / pre_far
 *
 * @param {object} input
 * @param {object} input.market - { end_date?: string ISO }
 * @param {Array<{event_time_utc: string, event_type?: string, priority?: number}>} input.eventCalendar
 *        — events for THIS market only (caller filters by market_id)
 * @param {number} input.nowMs - current epoch ms (for deterministic testing)
 * @returns {{ state: string, nextEventAt: string|null, hoursToEvent: number|null }}
 */
export function computeLifecycleState({ market, eventCalendar, nowMs }) {
  if (typeof nowMs !== 'number') throw new Error(`computeLifecycleState: invalid nowMs ${nowMs}`);
  if (!Array.isArray(eventCalendar)) throw new Error('computeLifecycleState: eventCalendar must be array');

  // Rule 1: resolved (terminal, market.end_date passed)
  if (market?.end_date) {
    const endMs = new Date(market.end_date).getTime();
    if (!Number.isNaN(endMs) && endMs <= nowMs) {
      return { state: 'resolved', nextEventAt: null, hoursToEvent: null };
    }
  }

  // Partition eventCalendar into past + future relative to nowMs
  const events = eventCalendar
    .map(e => ({ ...e, ms: new Date(e.event_time_utc).getTime() }))
    .filter(e => !Number.isNaN(e.ms));

  const past = events.filter(e => e.ms <= nowMs).sort((a, b) => b.ms - a.ms); // latest past first
  const future = events.filter(e => e.ms > nowMs).sort((a, b) => a.ms - b.ms); // earliest future first

  // Rule 2-5: check nearest past event for live-tail states (just_ended / priced_in)
  const lastEvent = past[0];
  if (lastEvent) {
    const delta = nowMs - lastEvent.ms; // 0 ≤ delta
    if (delta <= LIVE_WINDOW_MS) {
      // Past event still within ±2h live window (post-side)
      return { state: 'event_live', nextEventAt: lastEvent.event_time_utc, hoursToEvent: -(delta / MS_PER_HOUR) };
    }
    if (delta <= LIVE_WINDOW_MS + JUST_ENDED_WINDOW_MS) {
      return { state: 'just_ended', nextEventAt: lastEvent.event_time_utc, hoursToEvent: -(delta / MS_PER_HOUR) };
    }
    if (delta <= LIVE_WINDOW_MS + PRICED_IN_WINDOW_MS) {
      return { state: 'priced_in', nextEventAt: lastEvent.event_time_utc, hoursToEvent: -(delta / MS_PER_HOUR) };
    }
    // older past event: fall through to future-event logic
  }

  // Rule 6-7 + 2-3: future event determines imminent / live / pre_near / pre_far
  const nextEvent = future[0];
  if (nextEvent) {
    const ttg = nextEvent.ms - nowMs; // time-to-go > 0
    if (ttg <= IMMINENT_WINDOW_MS) {
      return { state: 'event_imminent', nextEventAt: nextEvent.event_time_utc, hoursToEvent: ttg / MS_PER_HOUR };
    }
    if (ttg <= LIVE_WINDOW_MS) {
      // Pre-event side within ±2h
      return { state: 'event_live', nextEventAt: nextEvent.event_time_utc, hoursToEvent: ttg / MS_PER_HOUR };
    }
    if (ttg <= PRE_NEAR_WINDOW_MS) {
      return { state: 'pre_event_near', nextEventAt: nextEvent.event_time_utc, hoursToEvent: ttg / MS_PER_HOUR };
    }
  }

  // Default: no recent event + no near future event → pre_event_far
  return {
    state: 'pre_event_far',
    nextEventAt: nextEvent?.event_time_utc || null,
    hoursToEvent: nextEvent ? (nextEvent.ms - nowMs) / MS_PER_HOUR : null,
  };
}
