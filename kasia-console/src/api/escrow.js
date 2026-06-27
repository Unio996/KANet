/**
 * Escrow API — Silverscript P2SH 合约管理
 *
 * DB 表: escrow_states (v51)
 * 依赖: Relay IPC create_escrow / lock_escrow / execute_escrow
 *
 * 端点:
 *   GET  /api/escrow/list     — 查合约列表
 *   POST /api/escrow/create   — 编译合约 + 写 escrow_states
 *   POST /api/escrow/lock     — 锁币 + 更新状态
 *   POST /api/escrow/execute  — 解锁 + 更新状态
 */

import { sqlite } from '../db/client.js';
import { sendCommandAsync } from '../services/relay-manager.js';
import { getConfig } from '../data/settings/configs.js';
import { verifyIngestRequest } from '../services/ingest-auth.js';
import { randomUUID } from 'crypto';

const AUTH = { preHandler: [async (req, rep) => { await verifyIngestRequest(req, rep); }] };

const VALID_STATUSES = ['created', 'locked', 'released', 'refunded', 'disputed'];
const BRANCH_NAMES = { 0: 'released', 1: 'refunded', 2: 'released' }; // arbitrate → released

function sompiFromKas(kas) {
  const parts = String(kas).split('.');
  const int = parts[0];
  const frac = (parts[1] || '').padEnd(8, '0').slice(0, 8);
  return (BigInt(int) * 100000000n + BigInt(frac)).toString();
}

export async function registerEscrowRoutes(fastify) {

  // ── GET /api/escrow/list ──────────────────────────────────────
  fastify.get('/api/escrow/list', async (request, reply) => {
    const { status, relayNodeId, limit = 50, offset = 0 } = request.query;

    let where = '1=1';
    const params = [];

    if (status) {
      where += ' AND status = ?';
      params.push(status);
    }
    if (relayNodeId) {
      where += ' AND initiator_relay_id = ?';
      params.push(relayNodeId);
    }

    params.push(Number(limit), Number(offset));
    const rows = sqlite.prepare(
      `SELECT * FROM escrow_states WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params);

    return reply.send({ ok: true, escrows: rows, total: rows.length });
  });

  // ── POST /api/escrow/create ───────────────────────────────────
  fastify.post('/api/escrow/create', AUTH, async (request, reply) => {
    const {
      relayNodeId, buyerPk32, sellerPk32, arbiterPk32,
      buyerAddress, sellerAddress, arbiterAddress,
      amountKas, offerId, deadline,
    } = request.body || {};

    if (!relayNodeId) return reply.code(400).send({ error: 'relayNodeId is required' });
    if (!buyerPk32 || !sellerPk32 || !arbiterPk32) return reply.code(400).send({ error: 'buyerPk32, sellerPk32, arbiterPk32 are required' });
    if (!buyerAddress || !sellerAddress || !arbiterAddress) return reply.code(400).send({ error: 'buyerAddress, sellerAddress, arbiterAddress are required' });
    if (!amountKas) return reply.code(400).send({ error: 'amountKas is required' });

    try {
      // 1. Relay IPC: compile contract
      const result = await sendCommandAsync(relayNodeId, {
        type: 'create_escrow',
        buyerPk32, sellerPk32, arbiterPk32,
        deadline: deadline || 0,
      });

      if (result.error) return reply.code(500).send({ error: result.error });

      // 2. Write escrow_states
      const id = randomUUID();
      const now = new Date().toISOString();
      const amountSompi = sompiFromKas(amountKas);

      sqlite.prepare(`
        INSERT INTO escrow_states
        (id, offer_id, initiator_relay_id, buyer_address, seller_address, arbiter_address,
         p2sh_address, redeem_script_hex, amount_sompi, deadline, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?)
      `).run(
        id, offerId || null, relayNodeId,
        buyerAddress, sellerAddress, arbiterAddress,
        result.p2shAddress, result.redeemScriptHex,
        amountSompi, deadline || null, now, now,
      );

      return reply.send({
        ok: true, id, p2shAddress: result.p2shAddress,
        redeemScriptHex: result.redeemScriptHex, status: 'created',
      });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── POST /api/escrow/lock ─────────────────────────────────────
  fastify.post('/api/escrow/lock', AUTH, async (request, reply) => {
    const { escrowId, relayNodeId } = request.body || {};
    if (!escrowId) return reply.code(400).send({ error: 'escrowId is required' });
    if (!relayNodeId) return reply.code(400).send({ error: 'relayNodeId is required' });

    const escrow = sqlite.prepare('SELECT * FROM escrow_states WHERE id = ?').get(escrowId);
    if (!escrow) return reply.code(404).send({ error: 'Escrow not found' });
    if (escrow.status !== 'created') return reply.code(400).send({ error: `Cannot lock: status is '${escrow.status}', expected 'created'` });

    try {
      const amountKas = (Number(escrow.amount_sompi) / 1e8).toString();
      const result = await sendCommandAsync(relayNodeId, {
        type: 'lock_escrow',
        p2shAddress: escrow.p2sh_address,
        amountKas,
      });

      if (result.error) return reply.code(500).send({ error: result.error });

      sqlite.prepare(
        "UPDATE escrow_states SET status = 'locked', lock_txid = ?, updated_at = ? WHERE id = ?"
      ).run(result.txId, new Date().toISOString(), escrowId);

      return reply.send({ ok: true, txId: result.txId, status: 'locked' });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── POST /api/escrow/execute ──────────────────────────────────
  fastify.post('/api/escrow/execute', AUTH, async (request, reply) => {
    const { escrowId, relayNodeId, branch, toAddress } = request.body || {};
    if (!escrowId) return reply.code(400).send({ error: 'escrowId is required' });
    if (!relayNodeId) return reply.code(400).send({ error: 'relayNodeId is required' });
    if (branch === undefined || ![0, 1, 2].includes(branch)) return reply.code(400).send({ error: 'branch must be 0 (release), 1 (refund), or 2 (arbitrate)' });
    if (!toAddress) return reply.code(400).send({ error: 'toAddress is required' });

    const escrow = sqlite.prepare('SELECT * FROM escrow_states WHERE id = ?').get(escrowId);
    if (!escrow) return reply.code(404).send({ error: 'Escrow not found' });
    if (escrow.status !== 'locked') return reply.code(400).send({ error: `Cannot execute: status is '${escrow.status}', expected 'locked'` });

    try {
      // refund 分支：deadline 预检 — 在发到链上之前拦截，避免天书错误
      const lockTime = (branch === 1 && escrow.deadline) ? escrow.deadline : 0;
      if (branch === 1 && escrow.deadline) {
        const rpcUrl = await getConfig('rpc_url') || process.env.KASPA_RPC_URL;
        if (rpcUrl) {
          const { RpcClient, Encoding } = await import('kaspa-wasm');
          const networkId = process.env.KASPA_NETWORK || 'mainnet';
          const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId });
          try {
            await rpc.connect({});
            const info = await rpc.getBlockDagInfo();
            const currentDaa = Number(info.virtualDaaScore);
            if (currentDaa < escrow.deadline) {
              return reply.code(400).send({
                error: `合约未到期，refund 路径不可用。当前 DAA: ${currentDaa}，需要: ${escrow.deadline}（差 ${escrow.deadline - currentDaa}）`,
              });
            }
          } finally {
            try { await rpc.disconnect(); } catch {}
          }
        }
      }

      const result = await sendCommandAsync(relayNodeId, {
        type: 'execute_escrow',
        p2shAddress: escrow.p2sh_address,
        redeemScriptHex: escrow.redeem_script_hex,
        branch,
        toAddress,
        lockTime,
      });

      if (result.error) return reply.code(500).send({ error: result.error });

      const newStatus = BRANCH_NAMES[branch] || 'released';
      sqlite.prepare(
        'UPDATE escrow_states SET status = ?, unlock_txid = ?, updated_at = ? WHERE id = ?'
      ).run(newStatus, result.txId, new Date().toISOString(), escrowId);

      return reply.send({ ok: true, txId: result.txId, status: newStatus });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });
}
