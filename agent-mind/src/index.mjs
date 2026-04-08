/**
 * agent-mind — KANet Agent Mind (Soul)
 *
 * Five-kernel subjective intelligence layer.
 * Sits above the Adapter (nervous system) and AI providers (brains).
 *
 * Usage: AGENT_NAME=martin node src/index.mjs
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonFile } from './utils.mjs';
import { SelfKernel } from './kernels/self.mjs';
import { MemoryKernel } from './kernels/memory.mjs';
import { PerceptionKernel } from './kernels/perception.mjs';
import { IntentKernel } from './kernels/intent.mjs';
import { EvolutionKernel } from './kernels/evolution.mjs';
import { AgentRunner } from './runner.mjs';
import { SkillRegistry } from './skills/registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const MINDS_DIR = path.join(PROJECT_ROOT, 'minds');

async function main() {
  const agentName = (process.env.AGENT_NAME || 'martin').toLowerCase();
  const configPath = path.join(MINDS_DIR, agentName, 'config.json');

  console.log(`[agent-mind] Loading agent: ${agentName}`);
  console.log(`[agent-mind] Config path: ${configPath}`);

  // Load config
  const config = await readJsonFile(configPath);
  if (!config) {
    console.error(`[agent-mind] FATAL: Config not found at ${configPath}`);
    process.exit(1);
  }

  console.log(`[agent-mind] Agent: ${config.name}`);
  console.log(`[agent-mind] Address: ${config.address}`);
  console.log(`[agent-mind] Adapter: ${config.adapterUrl}`);
  console.log(`[agent-mind] Console: ${config.consoleUrl}`);

  // Initialize all 5 kernels
  console.log(`[agent-mind] Initializing kernels...`);

  const kernels = {
    self: new SelfKernel(config),
    memory: new MemoryKernel(config, MINDS_DIR),
    perception: new PerceptionKernel(config),
    intent: new IntentKernel(config, MINDS_DIR),
    evolution: new EvolutionKernel(config, MINDS_DIR),
  };

  // Initialize stateful kernels (load from disk)
  await Promise.all([
    kernels.memory.init(),
    kernels.intent.init(),
    kernels.evolution.init(),
  ]);

  console.log(`[agent-mind] All kernels initialized`);

  // Auto-discover skills from files, filter by Console DB enabled status
  console.log(`[agent-mind] Discovering skills...`);
  const skillRegistry = new SkillRegistry(config.consoleUrl, config.relayNodeId);
  await skillRegistry.autoDiscover();

  // Create and start runner
  const runner = new AgentRunner(config, kernels, skillRegistry);

  // Graceful shutdown
  const shutdown = async () => {
    console.log(`\n[agent-mind] Shutting down ${config.name}...`);
    runner.stop();

    // Save all state before exit
    try {
      await Promise.all([
        kernels.memory.save(),
        kernels.intent.save(),
        kernels.evolution.save(),
      ]);
      console.log(`[agent-mind] State saved. Goodbye.`);
    } catch (err) {
      console.log(`[agent-mind] State save on shutdown failed: ${err.message}`);
    }

    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Report registered skills to Console
  try {
    await fetch(`${config.consoleUrl}/api/agent/mind-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName: config.name,
        eventType: 'mind_started',
        summary: `${config.name} Mind started with skills: [${skillRegistry.list().map(s => s.name).join(', ')}]`,
        payload: { skills: skillRegistry.list() },
      }),
    });
  } catch {}

  // Start the mind
  console.log(`[agent-mind] Starting ${config.name}'s mind...`);
  console.log(`[agent-mind] ----------------------------------------`);
  await runner.start();
}

main().catch(err => {
  console.error(`[agent-mind] FATAL: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
