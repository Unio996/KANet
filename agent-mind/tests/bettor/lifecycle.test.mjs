/**
 * Bettor Phase 3f-1 Sub #4 — Lifecycle State Machine unit tests (r55 spec, 7 cases).
 * Run: node --test agent-mind/tests/bettor/lifecycle.test.mjs
 *
 * 一 state 一 case. Eurovision Final 2026-05-16T19:00Z 当 anchor 事件.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { computeLifecycleState, LIFECYCLE_STATES } from '../../src/skills/bettor/lifecycle.mjs';

const EVENT_TIME = '2026-05-16T19:00:00.000Z';
const eventMs = new Date(EVENT_TIME).getTime();
const cal = [{ event_time_utc: EVENT_TIME, event_type: 'final', priority: 9 }];
const market = { end_date: '2026-05-20T23:59:59.000Z' }; // 4d after event

// ── 7 state cases ───────────────────────────────────────────────────────────

test('resolved: market.end_date passed → state=resolved, no event reference', () => {
  const r = computeLifecycleState({
    market: { end_date: '2026-05-01T00:00:00Z' },
    eventCalendar: cal,
    nowMs: new Date('2026-05-12T00:00:00Z').getTime(),
  });
  assert.equal(r.state, 'resolved');
  assert.equal(r.nextEventAt, null);
});

test('event_imminent: 15min before event → state=event_imminent', () => {
  const r = computeLifecycleState({
    market, eventCalendar: cal,
    nowMs: eventMs - 15 * 60 * 1000,
  });
  assert.equal(r.state, 'event_imminent');
  assert.equal(r.nextEventAt, EVENT_TIME);
  assert.ok(r.hoursToEvent > 0 && r.hoursToEvent < 0.5);
});

test('event_live: 1h before event → state=event_live (within ±2h window)', () => {
  const r = computeLifecycleState({
    market, eventCalendar: cal,
    nowMs: eventMs - 60 * 60 * 1000,
  });
  assert.equal(r.state, 'event_live');
  assert.ok(r.hoursToEvent > 0.9 && r.hoursToEvent < 1.1);
});

test('event_live (post): 1h after event → state=event_live (within ±2h post)', () => {
  const r = computeLifecycleState({
    market, eventCalendar: cal,
    nowMs: eventMs + 60 * 60 * 1000,
  });
  assert.equal(r.state, 'event_live');
  assert.ok(r.hoursToEvent < 0); // negative = past
});

test('just_ended: 2h 15min after event → state=just_ended (within 30min of live tail)', () => {
  const r = computeLifecycleState({
    market, eventCalendar: cal,
    nowMs: eventMs + (2 * 60 + 15) * 60 * 1000,
  });
  assert.equal(r.state, 'just_ended');
});

test('priced_in: 4h after event → state=priced_in (利好出尽 SKIP)', () => {
  const r = computeLifecycleState({
    market, eventCalendar: cal,
    nowMs: eventMs + 4 * 60 * 60 * 1000,
  });
  assert.equal(r.state, 'priced_in');
});

test('pre_event_near: 3 days before event → state=pre_event_near (≤7d window)', () => {
  const r = computeLifecycleState({
    market, eventCalendar: cal,
    nowMs: eventMs - 3 * 24 * 60 * 60 * 1000,
  });
  assert.equal(r.state, 'pre_event_near');
});

test('pre_event_far: 30 days before event → state=pre_event_far (default)', () => {
  const r = computeLifecycleState({
    market, eventCalendar: cal,
    nowMs: eventMs - 30 * 24 * 60 * 60 * 1000,
  });
  assert.equal(r.state, 'pre_event_far');
});

test('LIFECYCLE_STATES export contains all 7 states + frozen', () => {
  assert.equal(LIFECYCLE_STATES.length, 7);
  assert.ok(LIFECYCLE_STATES.includes('pre_event_far'));
  assert.ok(LIFECYCLE_STATES.includes('resolved'));
  assert.throws(() => { LIFECYCLE_STATES.push('extra'); });
});
