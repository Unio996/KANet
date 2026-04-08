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
  }

  /**
   * @param {'proactive'|'reactive'|'reflect'} taskType
   * @param {object} context - { self, memory, perception, intent, evolution }
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
