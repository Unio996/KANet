// agent_base_lock_isolation_lasterror — Phase 5-4 KI 43.1 regression (NWT N19.86 residual #2)
//
// Tests _agent_base.mjs production behavior:
//   T1: 2 runAgentLoop concurrent same (relayId, brokerKasia) → 2nd returns lock_held
//   T2: brain mutation of state._ownFlags doesn't leak to state.context (per-agent isolation)
//   T3: action throws → next iter brain sees state.lastError → stop (no retry storm)
//   T4: totalTimeoutMs exceeded → ok=false, completionReason='wall_clock_timeout'
//
// Pure unit-level — mock brain returns scripted decisions, no real chain.

export default {
  id: 'agent_base_lock_isolation_lasterror',
  description: 'KI 43.1: agent_base lock + ownFlags + lastError + timeout regression',
  domain: 'multi-agent',
  tags: ['regression', 'p0', 'ki-43', 'agent-base'],

  async run() {
    const { runAgentLoop, makeStopDecision } = await import('../../personas/agent/_agent_base.mjs');
    const failures = [];

    // T1: concurrent lock — 2 agents same (relay, broker)
    let t1Inner1Released = false;
    let t1Inner1Promise = runAgentLoop({
      id: 't1_first', persona: { id: 't1_first' },
      context: { relayId: 'test-relay-A', brokerKasia: 'kaspa:test_broker_T1' },
      goal: {}, policy: {},
      brainFn: async (state) => {
        // hold lock by waiting 500ms then stop
        await new Promise(r => setTimeout(r, 500));
        return makeStopDecision('t1_done');
      },
      maxSteps: 1,
    });
    // give first time to acquire lock
    await new Promise(r => setTimeout(r, 100));
    const t1Second = await runAgentLoop({
      id: 't1_second', persona: { id: 't1_second' },
      context: { relayId: 'test-relay-A', brokerKasia: 'kaspa:test_broker_T1' },
      goal: {}, policy: {},
      brainFn: () => makeStopDecision('should_not_reach'),
      maxSteps: 1,
    });
    await t1Inner1Promise;  // drain first
    if (t1Second.ok !== false) failures.push(`T1: 2nd lock attempt ok=${t1Second.ok} expected false (lock_held)`);
    if (!String(t1Second.finalState?.completionReason || '').includes('agent_lock_held')) {
      failures.push(`T1: completionReason=${t1Second.finalState?.completionReason} expected agent_lock_held`);
    }

    // T2: brain mutation of state._ownFlags isolated, NOT affect state.context
    const sharedContext = { relayId: 'test-relay-B', brokerKasia: 'kaspa:test_broker_T2', tag: 'shared' };
    const t2Result = await runAgentLoop({
      id: 't2', persona: { id: 't2' },
      context: sharedContext,
      goal: {}, policy: {},
      brainFn: (state) => {
        state._ownFlags.testFlag = 'mutated';
        return makeStopDecision('t2_done');
      },
      maxSteps: 1,
    });
    if (sharedContext.testFlag !== undefined) {
      failures.push(`T2: state._ownFlags leaked to shared context — testFlag=${sharedContext.testFlag}`);
    }

    // T3: brain sees lastError after action throws
    let t3Iter = 0;
    const t3Result = await runAgentLoop({
      id: 't3', persona: { id: 't3' },
      context: { relayId: 'test-relay-C', brokerKasia: 'kaspa:test_broker_T3' },
      goal: {}, policy: {},
      brainFn: (state) => {
        t3Iter++;
        if (t3Iter === 1) {
          // Trigger an error: use unknown action → runAgentLoop catches it but doesn't throw to brain
          // Better trigger: send_dm with no payload → runAgentLoop throws
          return { action: 'send_dm', payload: {} };  // missing message
        }
        if (state.lastError) {
          return makeStopDecision('t3_saw_lastError', 't3_completed');
        }
        // brain didn't see lastError — should not happen
        return makeStopDecision('t3_no_lastError_seen');
      },
      maxSteps: 3,
    });
    if (!t3Result.ok || !String(t3Result.finalState.completionReason || '').includes('t3_saw_lastError')) {
      failures.push(`T3: brain didn't see lastError — completionReason=${t3Result.finalState.completionReason}`);
    }

    // T4: totalTimeoutMs deadline
    let t4Iter = 0;
    const t4Result = await runAgentLoop({
      id: 't4', persona: { id: 't4' },
      context: { relayId: 'test-relay-D', brokerKasia: 'kaspa:test_broker_T4' },
      goal: {}, policy: {},
      brainFn: async (state) => {
        t4Iter++;
        // Each brain call burns 100ms
        await new Promise(r => setTimeout(r, 100));
        // Always continue (returns valid non-stop action) — runAgentLoop must stop via deadline
        return { action: 'send_dm', payload: { message: '1', timeoutMs: 50 } };
      },
      maxSteps: 100,
      totalTimeoutMs: 300,  // tight 300ms cap
    });
    if (t4Result.ok !== false || !String(t4Result.finalState?.completionReason || '').includes('wall_clock_timeout')) {
      failures.push(`T4: timeout not enforced — completionReason=${t4Result.finalState?.completionReason} iter=${t4Iter}`);
    }

    if (failures.length > 0) {
      return { ok: false, error: failures.join('; '), failures };
    }
    return { ok: true, summary: '4 KI 43 invariants verified (lock / ownFlags isolation / lastError visibility / wall-clock timeout)' };
  },
};
