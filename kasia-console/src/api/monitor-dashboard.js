// monitor-dashboard.js — Monitor API routes + frontend page
// GET/PUT /api/monitor/rules
// GET /api/monitor/events
// GET /api/monitor/stats
// POST /api/monitor/events/:id/ack
// POST /api/monitor/events/:id/clear

import { randomUUID } from 'crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRules, saveRules, toggleRule, deleteRule, addRule } from '../services/monitor-rules.js';
import { getStats } from '../services/monitor-service.js';
import { sqlite } from '../db/client.js';

const HTML_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'monitor-dashboard.html');

export async function registerMonitorRoutes(fastify) {

  // ── GET /api/monitor/stats ──
  fastify.get('/api/monitor/stats', async () => getStats());

  // ── GET /api/monitor/rules ──
  fastify.get('/api/monitor/rules', async () => ({ rules: loadRules() }));

  // ── PUT /api/monitor/rules ──
  fastify.put('/api/monitor/rules', async (request) => {
    const rules = request.body.rules;
    if (!Array.isArray(rules)) {
      return { error: 'body.rules must be an array' };
    }
    return saveRules(rules);
  });

  // ── POST /api/monitor/rules/:id/toggle ──
  fastify.post('/api/monitor/rules/:id/toggle', async (request) => {
    return toggleRule(request.params.id);
  });

  // ── POST /api/monitor/rules/:id/delete ──
  fastify.post('/api/monitor/rules/:id/delete', async (request) => {
    return deleteRule(request.params.id);
  });

  // ── POST /api/monitor/rules/new ──
  fastify.post('/api/monitor/rules/new', async (request) => {
    return addRule(request.body);
  });

  // ── GET /api/monitor/events ──
  fastify.get('/api/monitor/events', async (request) => {
    const query = request.query;
    const page = parseInt(query.page) || 1;
    const perPage = Math.min(parseInt(query.perPage) || 50, 200);
    const offset = (page - 1) * perPage;

    let where = '1=1';
    const params = [];

    if (query.rule_id) {
      where += ' AND rule_id = ?';
      params.push(query.rule_id);
    }
    if (query.channel) {
      where += ' AND channel_name = ?';
      params.push(query.channel);
    }
    if (query.alert_level) {
      where += ' AND alert_level = ?';
      params.push(query.alert_level);
    }
    if (query.unack !== undefined && parseInt(query.unack)) {
      where += ' AND acknowledged = 0 AND cleared = 0';
    }

    const total = sqlite.prepare(`SELECT COUNT(*) as cnt FROM monitor_events WHERE ${where}`).get(...params).cnt;
    const events = sqlite.prepare(`
      SELECT * FROM monitor_events WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, perPage, offset);

    return { events, total, page, perPage, totalPages: Math.ceil(total / perPage) };
  });

  // ── POST /api/monitor/events/:id/ack ──
  fastify.post('/api/monitor/events/:id/ack', async (request) => {
    sqlite.prepare("UPDATE monitor_events SET acknowledged = 1 WHERE id = ?").run(request.params.id);
    return { ok: true };
  });

  // ── POST /api/monitor/events/:id/clear ──
  fastify.post('/api/monitor/events/:id/clear', async (request) => {
    sqlite.prepare("UPDATE monitor_events SET cleared = 1 WHERE id = ?").run(request.params.id);
    return { ok: true };
  });


  // ── GET /monitor (frontend page) — HTML 在 monitor-dashboard.html, route 读文件返 (避 template literal 嵌套 backtick syntax)
  fastify.get('/monitor', async (req, reply) => {
    reply.type('text/html').send(fs.readFileSync(HTML_PATH, 'utf8'));
  });
}
