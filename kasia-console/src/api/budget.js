import {
  getRelayBudget,
  setRelayBudget,
  clearRelayBudget,
  getBudgetInfo,
  getAllBudgetSummaries,
} from '../services/social-budget.js';

export async function registerBudgetRoutes(fastify) {

  // GET /api/budget/summary — all agents budget summary
  fastify.get('/api/budget/summary', async (request, reply) => {
    try {
      const summaries = await getAllBudgetSummaries();
      return reply.send({ summaries });
    } catch (err) {
      console.error('[budget] summary error:', err.message);
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/budget/:relayId — single agent budget info
  fastify.get('/api/budget/:relayId', async (request, reply) => {
    const { relayId } = request.params;
    try {
      const info = await getBudgetInfo(relayId);
      return reply.send({ ...info, relayId });
    } catch (err) {
      console.error(`[budget] info error (${relayId}):`, err.message);
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/budget/:relayId — set budget for a relay node
  fastify.post('/api/budget/:relayId', async (request, reply) => {
    const { relayId } = request.params;
    const { budgetKas } = request.body || {};
    const val = parseFloat(budgetKas);
    if (isNaN(val) || val < 0) {
      return reply.code(400).send({ error: 'budgetKas must be a non-negative number' });
    }
    try {
      await setRelayBudget(relayId, val);
      return reply.send({ ok: true, relayId, budgetKas: val });
    } catch (err) {
      console.error(`[budget] set error (${relayId}):`, err.message);
      return reply.code(500).send({ error: err.message });
    }
  });

  // DELETE /api/budget/:relayId — reset to unlimited
  fastify.delete('/api/budget/:relayId', async (request, reply) => {
    const { relayId } = request.params;
    try {
      clearRelayBudget(relayId);
      return reply.send({ ok: true, relayId, unlimited: true });
    } catch (err) {
      console.error(`[budget] clear error (${relayId}):`, err.message);
      return reply.code(500).send({ error: err.message });
    }
  });
}
