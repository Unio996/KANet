/**
 * Evolution Kernel — "How do I evolve?"
 *
 * Periodic reflection: reviews chain history, extracts patterns,
 * asks AI brain for meta-reasoning, saves insights.
 */

import path from 'node:path';
import { readJsonFile, writeJsonFile, fetchJson } from '../utils.mjs';

const MAX_REFLECTIONS = 50;

export class EvolutionKernel {
  constructor(config, mindsDir) {
    this.config = config;
    this.mindsDir = mindsDir;
    this.reflectionsFile = path.join(mindsDir, config.name.toLowerCase(), 'reflections.json');
    this.reflections = [];
    this.patterns = [];
    this.lastReflectionTime = 0;
  }

  async init() {
    const saved = await readJsonFile(this.reflectionsFile);
    if (saved) {
      this.reflections = saved.reflections || [];
      this.patterns = saved.patterns || [];
      this.lastReflectionTime = saved.lastReflectionTime || 0;
      console.log(`[agent-mind:evolution] Loaded ${this.reflections.length} reflections, ${this.patterns.length} patterns`);
    }
  }

  async save() {
    try {
      await writeJsonFile(this.reflectionsFile, {
        reflections: this.reflections,
        patterns: this.patterns,
        lastReflectionTime: this.lastReflectionTime,
        savedAt: new Date().toISOString(),
      });
      console.log(`[agent-mind:evolution] Saved ${this.reflections.length} reflections to ${this.reflectionsFile}`);
    } catch (err) {
      console.error(`[agent-mind:evolution] SAVE FAILED: ${err.message} path=${this.reflectionsFile}`);
      throw err;
    }
  }

  /**
   * Add a parsed reflection from Mind's reflect cycle.
   */
  addReflection(reflection) {
    this.reflections.unshift({
      ...reflection,
      timestamp: new Date().toISOString(),
    });
    // Keep last 50 reflections
    if (this.reflections.length > 50) this.reflections = this.reflections.slice(0, 50);
    this.lastReflectionTime = Date.now();
  }

  /**
   * Run a reflection cycle using the AI brain (via Adapter).
   *
   * @param {object} fullContext - The full subjectified context from context-builder
   * @returns {object|null} reflection result
   */
  async runReflectionCycle(fullContext) {
    const { adapterUrl, name } = this.config;

    console.log(`[agent-mind:evolution] Starting reflection cycle for ${name}...`);

    // Build a reflection prompt
    const reflectionTask = {
      ...fullContext,
      task: {
        type: 'reflect',
        input: {
          recentReflections: this.reflections.slice(-5),
          currentPatterns: this.patterns,
          totalInteractions: fullContext.memory?.totalEventsInMemory || 0,
        },
        instructions: [
          `You are ${name}, reflecting on your recent experiences on the Kasia network.`,
          'Review your recent interactions, relationships, and network observations.',
          'Identify patterns in your behavior, common topics, or recurring situations.',
          'Consider whether your current goals are still relevant.',
          'Respond with a JSON object containing:',
          '  - "insight": a brief insight about your recent experience (string)',
          '  - "patterns": array of pattern strings you have noticed',
          '  - "suggestedGoals": array of {text, priority} for new goals (or empty)',
          '  - "retireGoals": array of goal IDs to retire (or empty)',
          '  - "priorityNote": a one-sentence note on what to prioritize next',
          '  - "priorityAdjustments": array of {goalId, newPriority} (or empty)',
          'Respond ONLY with the JSON object, no other text.',
        ].join('\n'),
      },
    };

    try {
      const response = await fetchJson(`${adapterUrl}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          peer: this.config.address,
          message: JSON.stringify(reflectionTask),
        }),
        brainCall: true,
      });

      if (response && response.reply) {
        // Try to parse reflection JSON from AI response
        let reflection;
        try {
          // Strip markdown code fences if present
          let raw = response.reply;
          raw = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
          reflection = JSON.parse(raw);
        } catch {
          // If AI didn't return valid JSON, create a basic reflection
          reflection = {
            insight: response.reply.slice(0, 200),
            patterns: [],
            suggestedGoals: [],
            retireGoals: [],
            priorityNote: 'Continue current activities.',
            priorityAdjustments: [],
          };
        }

        // Store the reflection
        this.reflections.push({
          timestamp: new Date().toISOString(),
          insight: reflection.insight,
          patterns: reflection.patterns || [],
        });

        // Update patterns (merge, dedup)
        if (Array.isArray(reflection.patterns)) {
          const existingSet = new Set(this.patterns);
          for (const p of reflection.patterns) {
            if (!existingSet.has(p)) {
              this.patterns.push(p);
            }
          }
          // Keep patterns bounded
          if (this.patterns.length > 30) {
            this.patterns = this.patterns.slice(-30);
          }
        }

        // Trim reflections
        if (this.reflections.length > MAX_REFLECTIONS) {
          this.reflections = this.reflections.slice(-MAX_REFLECTIONS);
        }

        this.lastReflectionTime = Date.now();
        await this.save();

        console.log(`[agent-mind:evolution] Reflection complete: "${reflection.insight?.slice(0, 80)}..."`);
        return reflection;
      }
    } catch (err) {
      console.log(`[agent-mind:evolution] Reflection cycle failed: ${err.message}`);
    }

    return null;
  }

  /**
   * Build structured evolution context.
   */
  async buildEvolutionContext() {
    return {
      recentReflections: this.reflections.slice(-5),
      totalReflections: this.reflections.length,
      patterns: this.patterns,
      lastReflectionTime: this.lastReflectionTime
        ? new Date(this.lastReflectionTime).toISOString()
        : null,
      hoursSinceLastReflection: this.lastReflectionTime
        ? (Date.now() - this.lastReflectionTime) / (60 * 60 * 1000)
        : null,
    };
  }
}
