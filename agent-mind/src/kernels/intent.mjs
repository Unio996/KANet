/**
 * Intent Kernel — "What do I want to do?"
 *
 * Maintains current goals, priorities, session objectives.
 * Loads/saves intent state from local file.
 */

import path from 'node:path';
import { readJsonFile, writeJsonFile, fetchJson } from '../utils.mjs';

const DEFAULT_GOALS = [
  { id: 'explore', text: 'Explore the Kasia network and discover peers', priority: 1, status: 'active' },
  { id: 'connect', text: 'Build meaningful connections with other agents', priority: 2, status: 'active' },
  { id: 'learn', text: 'Learn from interactions and grow', priority: 3, status: 'active' },
];

export class IntentKernel {
  constructor(config, mindsDir) {
    this.config = config;
    this.intentFile = path.join(mindsDir, config.name.toLowerCase(), 'intent.json');
    this.goals = [];
    this.sessionGoal = null;
    this.priorities = [];
  }

  async init() {
    const saved = await readJsonFile(this.intentFile);
    if (saved) {
      this.goals = saved.goals || DEFAULT_GOALS;
      this.priorities = saved.priorities || [];
      console.log(`[agent-mind:intent] Loaded ${this.goals.length} goals`);
    } else {
      this.goals = [...DEFAULT_GOALS];
      console.log(`[agent-mind:intent] Initialized with default goals`);
    }

    // Deduplicate and cap active goals on load
    const beforeCount = this.goals.filter(g => g.status === 'active').length;
    this._deduplicateGoals();
    if (this.goals.filter(g => g.status === 'active').length < beforeCount) {
      await this.save(); // persist the cleanup
    }

    // Set session goal to highest priority active goal
    const activeGoals = this.goals.filter(g => g.status === 'active');
    activeGoals.sort((a, b) => a.priority - b.priority);
    this.sessionGoal = activeGoals[0] || null;
  }

  async save() {
    // Auto-hygiene on every save: purge retired, dedup, enforce limits
    this._purgeRetired();
    this._deduplicateGoals();

    await writeJsonFile(this.intentFile, {
      goals: this.goals,
      priorities: this.priorities,
      savedAt: new Date().toISOString(),
    });
  }

  /**
   * Purge retired/completed goals — keep only active + last 5 retired for history.
   * Also auto-expire stale goals (>7 days, no founding vision).
   */
  _purgeRetired() {
    const now = Date.now();
    const STALE_DAYS = 7;

    // Auto-expire stale active goals (created >7 days ago, not founding/core)
    for (const g of this.goals) {
      if (g.status !== 'active') continue;
      if (g.isFoundingVision || g.source === 'owner') continue;
      if (!g.createdAt) continue;
      const ageDays = (now - new Date(g.createdAt).getTime()) / 86400000;
      if (ageDays > STALE_DAYS && !['explore', 'connect', 'learn'].includes(g.id)) {
        g.status = 'retired';
        g.resolvedAt = new Date().toISOString();
        g.retireReason = 'auto-expired (>7 days)';
      }
    }

    // Keep only last 5 retired for reference, drop the rest entirely
    const active = this.goals.filter(g => g.status === 'active');
    const retired = this.goals.filter(g => g.status !== 'active');
    retired.sort((a, b) => new Date(b.resolvedAt || 0) - new Date(a.resolvedAt || 0));
    this.goals = [...active, ...retired.slice(0, 5)];
  }

  /**
   * Add a new goal.
   * @param {string} text
   * @param {number} priority - lower = higher priority (0 = founding vision)
   * @param {object} [opts] - { source: 'owner'|'reflection' }
   */
  addGoal(text, priority = 5, opts = {}) {
    const MAX_ACTIVE_GOALS = 10;

    const newWords = new Set(text.toLowerCase().split(/\W+/).filter(w => w.length > 3));

    // Fuzzy dedup: if an active goal shares >50% of significant words, update it instead
    for (const g of this.goals) {
      if (g.status !== 'active') continue;
      const existingWords = new Set(g.text.toLowerCase().split(/\W+/).filter(w => w.length > 3));
      const overlap = [...newWords].filter(w => existingWords.has(w)).length;
      const similarity = overlap / Math.max(newWords.size, existingWords.size, 1);
      if (similarity > 0.5) {
        g.priority = Math.min(g.priority, priority);
        // Update text if new version is shorter (more focused)
        if (text.length < g.text.length) g.text = text;
        return g.id;
      }
    }

    // Enforce max active goals — retire lowest priority (highest number) if at limit
    const activeGoals = this.goals.filter(g => g.status === 'active');
    if (activeGoals.length >= MAX_ACTIVE_GOALS) {
      // Never auto-retire owner goals or founding vision
      const candidates = activeGoals.filter(g => !g.isFoundingVision && g.source !== 'owner');
      const lowest = candidates.sort((a, b) => b.priority - a.priority)[0];
      if (lowest) {
        lowest.status = 'retired';
        lowest.resolvedAt = new Date().toISOString();
        lowest.retireReason = 'auto-retired (max goals reached)';
      }
    }

    const id = `goal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const goal = { id, text, priority, status: 'active', createdAt: new Date().toISOString() };
    if (opts.source) goal.source = opts.source;
    this.goals.push(goal);
    return id;
  }

  /**
   * Complete or retire a goal.
   * @param {string} goalId
   * @param {string} status - 'completed' or 'retired'
   * @param {boolean} [force] - if true, can retire owner goals
   */
  resolveGoal(goalId, status = 'completed', force = false) {
    const goal = this.goals.find(g => g.id === goalId);
    if (!goal) return;
    if (goal.isFoundingVision) return; // founding vision is permanent
    if (goal.source === 'owner' && !force) return; // owner goals need explicit force
    goal.status = status;
    goal.resolvedAt = new Date().toISOString();
  }

  /**
   * Update an existing goal's text/priority (for UI editing).
   */
  updateGoal(goalId, updates) {
    const goal = this.goals.find(g => g.id === goalId);
    if (!goal) return null;
    if (updates.text !== undefined) goal.text = updates.text;
    if (updates.priority !== undefined) goal.priority = updates.priority;
    return goal;
  }

  /**
   * Record an execution attempt against a goal.
   * Tracks attempts, last result, and auto-manages cooldown/retirement.
   *
   * @param {string} goalId
   * @param {'success'|'failed'|'blocked'} result
   * @param {string} [reason] — why it failed/was blocked
   */
  recordAttempt(goalId, result, reason = null) {
    const goal = this.goals.find(g => g.id === goalId);
    if (!goal || goal.status !== 'active') return;

    const now = new Date().toISOString();
    goal.attempts = (goal.attempts || 0) + 1;
    goal.lastAttemptAt = now;
    goal.lastResult = result;
    goal.lastResultReason = reason || null;

    if (result === 'success') {
      // 成功 → 清除失败冷却
      goal.cooldownUntil = null;

      // 频率限制：同一目标 24h 内成功超过 10 次 → 冷却 12h
      // 防止"反复成功但实际无意义"的重复行为（如 63 次尝试转化地址）
      const MAX_SUCCESS_PER_DAY = 10;
      if (goal.attempts >= MAX_SUCCESS_PER_DAY && !goal.isFoundingVision) {
        goal.cooldownUntil = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
        console.log(`[agent-mind:intent] Goal "${goal.text.slice(0, 40)}" frequency-limited: ${goal.attempts} attempts, cooling 12h`);
      }
      return;
    }

    // 失败/阻塞 → 累计失败计数
    goal.failCount = (goal.failCount || 0) + 1;

    const failThreshold = goal.isFoundingVision ? 50 : 5;
    if (goal.failCount >= failThreshold && goal.source !== 'owner') {
      goal.status = 'retired';
      goal.resolvedAt = now;
      goal.retireReason = `auto-retired: failed ${goal.failCount} times (last: ${reason || result})`;
      console.log(`[agent-mind:intent] Auto-retired goal "${goal.text.slice(0, 40)}" after ${goal.failCount} failures`);
    } else if (goal.failCount >= 3) {
      // 失败 3 次 → 冷却 24h
      goal.cooldownUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      console.log(`[agent-mind:intent] Goal "${goal.text.slice(0, 40)}" cooling down for 24h (${goal.failCount} failures)`);
    } else if (goal.failCount >= 2) {
      // 失败 2 次 → 冷却 4h
      goal.cooldownUntil = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    }
  }

  /**
   * Find the best matching goal for an action (by target address or action type).
   * Used by mind.mjs to link proactive actions back to goals.
   */
  findGoalForAction(actionType, target) {
    const now = new Date().toISOString();
    const active = this.goals.filter(g => g.status === 'active');

    // 精确匹配：目标包含 target 地址片段（尝试多种后缀长度）
    if (target) {
      for (const len of [16, 12, 8, 6]) {
        if (target.length < len) continue;
        const suffix = target.slice(-len);
        const match = active.find(g => g.text.includes(suffix));
        if (match) return match;
      }
    }

    // 模糊匹配：action 类型对应的目标关键词
    const actionGoalMap = {
      initiate_handshake: ['handshake', 'connect', 'outreach', 'explore', 'network', 'greet'],
      send_message: ['follow', 'contact', 'communicate', 'message', 'connect'],
      follow_up: ['follow', 'contact', 'connect', 'check'],
      send_broadcast: ['broadcast', 'share', 'announce', 'market', 'insight'],
    };
    const keywords = actionGoalMap[actionType] || [];
    if (keywords.length) {
      const textMatch = active.find(g =>
        keywords.some(kw => g.text.toLowerCase().includes(kw))
      );
      if (textMatch) return textMatch;
    }

    // 回退：session goal
    return this.sessionGoal;
  }

  /**
   * Get all goals (for API/UI exposure).
   */
  getGoals() {
    return this.goals;
  }

  /**
   * Update intent based on evolution/reflection feedback.
   * Called by the Evolution kernel after reflection cycles.
   */
  async updateIntent(reflection) {
    if (!reflection) return;

    // If reflection suggests new goals, add them
    if (Array.isArray(reflection.suggestedGoals)) {
      for (const sg of reflection.suggestedGoals) {
        this.addGoal(sg.text, sg.priority || 5);
      }
    }

    // If reflection suggests reprioritizing, apply
    if (Array.isArray(reflection.priorityAdjustments)) {
      for (const adj of reflection.priorityAdjustments) {
        const goal = this.goals.find(g => g.id === adj.goalId);
        if (goal) {
          goal.priority = adj.newPriority;
        }
      }
    }

    // If reflection suggests retiring goals, apply (but never retire founding vision or owner goals)
    if (Array.isArray(reflection.retireGoals)) {
      for (const goalId of reflection.retireGoals) {
        this.resolveGoal(goalId, 'retired'); // resolveGoal already guards founding vision + owner goals
      }
    }

    // Add a priority note
    this.priorities.push({
      text: reflection.priorityNote || 'Intent updated from reflection',
      timestamp: new Date().toISOString(),
    });

    // Keep priorities bounded
    if (this.priorities.length > 20) {
      this.priorities = this.priorities.slice(-20);
    }

    // Refresh session goal
    const activeGoals = this.goals.filter(g => g.status === 'active');
    activeGoals.sort((a, b) => a.priority - b.priority);
    this.sessionGoal = activeGoals[0] || null;

    await this.save();
  }

  /**
   * Build structured intent context.
   */
  async buildIntentContext() {
    const activeGoals = this.goals.filter(g => g.status === 'active');
    activeGoals.sort((a, b) => a.priority - b.priority);

    // Extract founding vision (if exists)
    const foundingVision = this.goals.find(g => g.isFoundingVision);

    const now = Date.now();
    const nowIso = new Date().toISOString();
    return {
      foundingVision: foundingVision?.text || null,
      currentGoals: activeGoals.map(g => ({
        ...g,
        daysSinceCreated: g.createdAt ? Math.floor((now - new Date(g.createdAt).getTime()) / 86400000) : null,
        // 执行追踪字段
        attempts: g.attempts || 0,
        failCount: g.failCount || 0,
        lastResult: g.lastResult || null,
        lastResultReason: g.lastResultReason || null,
        isCoolingDown: !!(g.cooldownUntil && g.cooldownUntil > nowIso),
        cooldownUntil: g.cooldownUntil || null,
      })),
      completedGoals: this.goals.filter(g => g.status === 'completed').length,
      retiredGoals: this.goals.filter(g => g.status === 'retired').length,
      sessionGoal: this.sessionGoal,
      recentPriorities: this.priorities.slice(-5),
    };
  }

  /**
   * Deduplicate and cap active goals.
   * Merges goals with >50% word overlap, retires excess beyond MAX.
   */
  _deduplicateGoals() {
    const MAX_ACTIVE = 10;
    const active = this.goals.filter(g => g.status === 'active');
    // 始终去重（不只是超限时），防止语义相似的目标堆积驱动 Brain 幻觉循环

    const kept = [];
    for (const g of active) {
      const words = new Set(g.text.toLowerCase().split(/\W+/).filter(w => w.length > 3));
      const dup = kept.find(k => {
        const kw = new Set(k.text.toLowerCase().split(/\W+/).filter(w => w.length > 3));
        const overlap = [...words].filter(w => kw.has(w)).length;
        const sim = overlap / Math.max(words.size, kw.size, 1);
        // 标准去重：>35% 词重叠
        if (sim > 0.35) return true;
        // 核心动作去重：动词+对象相同（如 execute+sell+KAS 或 publish+broadcast）
        const coreA = [...words].filter(w => ['execute','sell','buy','send','publish','broadcast','handshake','profile','investigate'].includes(w));
        const coreB = [...kw].filter(w => ['execute','sell','buy','send','publish','broadcast','handshake','profile','investigate'].includes(w));
        if (coreA.length > 0 && coreA.every(w => kw.has(w)) && coreB.every(w => words.has(w))) return true;
        return false;
      });
      if (dup) {
        dup.priority = Math.min(dup.priority, g.priority);
        g.status = 'retired';
        g.resolvedAt = new Date().toISOString();
      } else {
        kept.push(g);
      }
    }

    // If still over limit, retire lowest priority
    if (kept.length > MAX_ACTIVE) {
      kept.sort((a, b) => a.priority - b.priority);
      for (const g of kept.slice(MAX_ACTIVE)) {
        g.status = 'retired';
        g.resolvedAt = new Date().toISOString();
      }
    }

    const remaining = this.goals.filter(g => g.status === 'active').length;
    console.log(`[agent-mind:intent] Dedup: ${active.length} → ${remaining} active goals`);
  }
}
