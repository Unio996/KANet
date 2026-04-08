/**
 * Agent Runner — single-target: run ONE proactive loop to prove the 8-step cycle.
 *
 * 1. Receive event (timer tick)
 * 2. Update perception
 * 3. Read self / memory / intent
 * 4. Assemble subjectified task
 * 5. Call Adapter → Brain
 * 6. Get candidate actions
 * 7. Execute actions
 * 8. Write back memory / reflections / intent
 */

import { fetchJson, sleep } from './utils.mjs';
import { ContextBuilder } from './context-builder.mjs';
import { ActionExecutor } from './action-executor.mjs';

const TICK_INTERVAL = 5_000;

export class AgentRunner {
  constructor(config, kernels, skillRegistry) {
    this.config = config;
    this.kernels = kernels;
    this.contextBuilder = new ContextBuilder(kernels, skillRegistry, config);
    this.executor = new ActionExecutor(config, kernels.memory);
    this.running = false;
    this.cycleCount = 0;
  }

  async start() {
    this.running = true;
    const { name } = this.config;
    console.log(`[runner] ${name} starting — proving the 8-step loop`);

    // Run the first proactive cycle immediately
    await this.runProactiveCycle();

    // Then enter the main loop
    while (this.running) {
      await sleep(TICK_INTERVAL);
      try {
        await this.tick();
      } catch (err) {
        console.log(`[runner] tick error: ${err.message}`);
      }
    }
  }

  stop() { this.running = false; }

  async tick() {
    const now = Date.now();
    const proactiveMs = (this.config.proactiveIntervalMinutes || 30) * 60_000;
    const evolutionMs = (this.config.evolutionIntervalHours || 24) * 3600_000;

    // Proactive cycle
    if (this.cycleCount === 0 || now % proactiveMs < TICK_INTERVAL) {
      // skip — first cycle already ran in start()
    }

    // Follow-ups
    const due = this.executor.getDueFollowups();
    for (const f of due) {
      console.log(`[runner] follow-up: ${f.note}`);
      await this.runProactiveCycle();
    }
  }

  /**
   * The 8-step subject loop.
   */
  async runProactiveCycle() {
    this.cycleCount++;
    const { name, adapterUrl } = this.config;
    console.log(`\n[runner] ========== CYCLE #${this.cycleCount} ==========`);

    // Step 1: Event received (timer / startup)
    console.log(`[runner] Step 1: Event — proactive timer (cycle #${this.cycleCount})`);

    // Step 2: Update perception (network state)
    console.log(`[runner] Step 2: Updating perception...`);
    await this.kernels.perception.refresh();

    // Step 3: Read self / memory / intent
    console.log(`[runner] Step 3: Reading self, memory, intent...`);

    // Step 4: Assemble layered context
    console.log(`[runner] Step 4: Building layered context...`);
    const task = await this.contextBuilder.buildProactiveTask();

    // Log what's going into the Brain
    const sysLen = task.system?.length || 0;
    const usrLen = task.user?.length || 0;
    console.log(`[runner]   system: ${sysLen}c${task.meta?.systemCacheHit ? ' (cached)' : ''}`);
    console.log(`[runner]   user: ${usrLen}c`);
    console.log(`[runner]   skills: ${(task.skills || []).map(s => s.name).join(', ') || '(none)'}`);

    // Step 5: Call Adapter → Brain
    console.log(`[runner] Step 5: Calling Brain via Adapter (${adapterUrl}/reply)...`);

    let brainResponse;
    try {
      brainResponse = await fetchJson(`${adapterUrl}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          peer: this.config.address,
          mindSystem: task.system,
          mindUser: task.user,
          mindTask: true,
        }),
        brainCall: true,
      });
    } catch (err) {
      console.log(`[runner]   Brain call FAILED: ${err.message}`);
      console.log(`[runner] ========== CYCLE #${this.cycleCount} ABORTED ==========\n`);
      return;
    }

    // Step 6: Parse candidate actions
    console.log(`[runner] Step 6: Parsing candidate actions...`);
    const rawReply = brainResponse?.reply || '';
    console.log(`[runner]   Brain raw (${rawReply.length} chars): ${rawReply.slice(0, 200)}${rawReply.length > 200 ? '...' : ''}`);

    const actions = this.parseActions(rawReply);
    console.log(`[runner]   Parsed ${actions.length} action(s): [${actions.map(a => a.type).join(', ')}]`);

    // Step 7: Execute actions
    console.log(`[runner] Step 7: Executing actions...`);
    if (actions.length > 0) {
      const results = await this.executor.executeActions(actions);
      for (const r of results) {
        console.log(`[runner]   ${r.action}: ${r.success ? 'OK' : 'FAIL ' + r.error}`);
      }
    } else {
      console.log(`[runner]   (no actions to execute)`);
    }

    // Step 8: Write back memory / intent state
    console.log(`[runner] Step 8: Saving state...`);

    // Record this cycle as an event in memory
    this.kernels.memory.recordEvent({
      type: 'proactive_cycle',
      from: this.config.address,
      summary: `Cycle #${this.cycleCount}: ${actions.length} action(s) [${actions.map(a => a.type).join(', ')}]`,
    });

    await this.saveAllState();

    // Report skill activity to Console (non-blocking)
    this.reportSkillActivity(task.skills || [], actions).catch(() => {});

    console.log(`[runner] ========== CYCLE #${this.cycleCount} COMPLETE ==========\n`);
  }

  /**
   * Report skill activity to Console event log.
   */
  async reportSkillActivity(skills, actions) {
    if (skills.length === 0) return;

    const { consoleUrl, name } = this.config;
    const skillNames = skills.map(s => s.name);
    const actionSummary = actions.length > 0
      ? actions.map(a => a.type).join(', ')
      : 'no action';

    // Build summary from skill data
    const summaryParts = [];
    for (const s of skills) {
      if (s.name === 'chain_sense' && s.data?.networkOverview) {
        const ov = s.data.networkOverview;
        summaryParts.push(`Chain Sense: ${ov.totalPeers} peers, ${ov.totalHandshakes} handshakes`);
        if (s.data.unknownActiveAddresses?.length > 0) {
          summaryParts.push(`  ${s.data.unknownActiveAddresses.length} unknown active`);
        }
        if (s.data.agentCards?.length > 0) {
          summaryParts.push(`  ${s.data.agentCards.length} agents with Card`);
        }
      }
      if (s.name === 'social_outreach' && s.data?.coverage) {
        const cov = s.data.coverage;
        summaryParts.push(`Social: ${cov.myHandshakes}/${cov.totalNetworkPeers} connected (${cov.coveragePercent}%)`);
        if (s.data.outreachTargets?.length > 0) {
          summaryParts.push(`  ${s.data.outreachTargets.length} outreach targets`);
        }
      }
    }

    const summary = `Cycle #${this.cycleCount} [${skillNames.join(', ')}] → ${actionSummary}` +
      (summaryParts.length > 0 ? ' | ' + summaryParts.join(' | ') : '');

    try {
      await fetchJson(`${consoleUrl}/api/agent/mind-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: name,
          eventType: 'skill_cycle',
          summary,
          payload: { cycle: this.cycleCount, skills: skillNames, actions: actions.map(a => a.type) },
        }),
      });
    } catch (err) {
      console.log(`[runner] skill report failed: ${err.message}`);
    }
  }

  /**
   * Parse AI response into action objects.
   */
  parseActions(reply) {
    try {
      let raw = reply.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed.actions)) return parsed.actions;
      if (parsed.action) {
        return [{
          type: parsed.action,
          target: parsed.target || null,
          text: parsed.message || null,
          message: parsed.message || null,
          reason: parsed.reason || null,
        }];
      }
      if (parsed.reply) return [{ type: 'send_reply', text: parsed.reply }];
      return [];
    } catch {
      if (reply && reply.trim()) {
        return [{ type: 'send_reply', text: reply.trim() }];
      }
      return [];
    }
  }

  async saveAllState() {
    try {
      await Promise.all([
        this.kernels.memory.save(),
        this.kernels.intent.save(),
        this.kernels.evolution.save(),
      ]);
      console.log(`[runner]   state saved`);
    } catch (err) {
      console.log(`[runner]   state save error: ${err.message}`);
    }
  }
}
