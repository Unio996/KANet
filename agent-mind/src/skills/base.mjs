/**
 * Skill Base Class
 *
 * Every skill implements three methods:
 *   canActivate(taskType, context) — should this skill contribute to the current task?
 *   gatherContext(kernels, config) — pull skill-specific data (async)
 *   formatForBrain(gathered) — return a structured object for the Brain
 */

export class Skill {
  constructor(name, description) {
    this.name = name;
    this.description = description;
    // Optional: subclass can set a keywords array. When set AND the task is
    // reactive AND an input message is available, the skill only activates
    // if the message contains at least one keyword (case-insensitive, plain
    // substring match — safe for CJK because we don't use \b).
    // Leave empty [] to keep the original unconditional behavior.
    this.keywords = [];
  }

  /**
   * Reactive keyword gate: returns true if we should keep activation ON.
   * Non-reactive tasks or skills without keywords always pass this gate.
   */
  _keywordsMatch(taskType, context) {
    if (taskType !== 'reactive') return true;
    if (!Array.isArray(this.keywords) || this.keywords.length === 0) return true;
    const msg = (context?._inputMessage || '').toLowerCase();
    if (!msg) return true;  // no message → can't gate, allow
    return this.keywords.some(kw => msg.includes(String(kw).toLowerCase()));
  }

  /**
   * @param {'proactive'|'reactive'|'reflect'} taskType
   * @param {object} context - { self, memory, perception, intent, evolution, _inputMessage }
   * @returns {boolean}
   */
  canActivate(taskType, context) {
    return false;
  }

  /**
   * Gather skill-specific data from Console/Scout/etc.
   * @param {object} kernels - { self, memory, perception, intent, evolution }
   * @param {object} config - agent config
   * @returns {Promise<object>} gathered data
   */
  async gatherContext(kernels, config) {
    return {};
  }

  /**
   * Format gathered data into a Brain-readable context section.
   * @param {object} gathered - result from gatherContext
   * @returns {object} { name, description, data, instructions }
   */
  formatForBrain(gathered) {
    return {
      name: this.name,
      description: this.description,
      data: gathered,
      instructions: '',
    };
  }
}
