import { listIdentities, updateIdentity, getIdentityById, upsertIdentity, isAddressBlocked, listBlockedAddresses, setTrustLevel, annotateIdentity, getAddressTrustLevel, getIdentityByAddress } from '../data/settings/identities.js';
import { listRelayNodes } from '../data/settings/relay-nodes.js';
import { parseLang, getT, isRtl, LANG_NAMES } from '../i18n/index.js';
import { sqlite } from '../db/client.js';
import { registerIdentity } from '../lib/u1-registration.mjs';
import { createChallengeStore, CANONICAL_CHALLENGE_TABLE } from '../lib/u1-challenge-store.mjs';

const TRUST_LEVELS = ['owner', 'recommended', 'normal', 'blocked'];

export async function registerIdentityRoutes(fastify) {

  // Address book page
  fastify.get('/identities', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    const filter = request.query.filter || 'all';
    const selectedAccount = request.query.account || '';
    const selectedTag = request.query.tag || '';
    const relayNodes = listRelayNodes();
    const all = await listIdentities();
    let local = all.filter(i => i.identity_type === 'local');
    let remote = all.filter(i => i.identity_type !== 'local');

    // Account filtering
    if (selectedAccount) {
      const node = relayNodes.find(r => r.id === selectedAccount);
      if (node && node.address) {
        // Local: only show this account's address
        local = local.filter(i => i.address === node.address);

        // Remote: show contacts from conversations + relation_states for this account
        const remoteIds = sqlite.prepare(`
          SELECT DISTINCT c.remote_identity_id FROM conversations c
          JOIN identities li ON c.local_identity_id = li.id
          WHERE li.address = ? AND c.remote_identity_id IS NOT NULL
        `).all(node.address).map(r => r.remote_identity_id);
        const remoteIdSet = new Set(remoteIds);

        // Also include identities tracked in relation_states (唯一真相源)
        const rsRows = sqlite.prepare(`
          SELECT rs.peer_address, rs.trust_level, rs.is_blocked, rs.status as rs_status,
                 i.id as identity_id
          FROM relation_states rs
          JOIN identities i ON i.address = rs.peer_address
          WHERE rs.local_address = ?
        `).all(node.address);
        const rsMap = {};
        for (const rs of rsRows) {
          if (rs.identity_id) remoteIdSet.add(rs.identity_id);
          rsMap[rs.identity_id] = rs;
        }

        remote = remote.filter(i => remoteIdSet.has(i.id));

        // Override identity-level fields with per-account values from relation_states
        remote = remote.map(i => {
          const rs = rsMap[i.id];
          if (!rs) return i;
          return {
            ...i,
            trust_level: rs.trust_level || i.trust_level,
            is_blocked: rs.is_blocked ?? i.is_blocked,
            _relation_status: rs.rs_status, // bonus: expose connection status
          };
        });
      }
    }

    // Apply filter — blocked hidden by default, only shown when explicitly selected
    if (filter === 'all') remote = remote.filter(i => i.trust_level !== 'blocked');
    else if (filter === 'owner') remote = remote.filter(i => i.trust_level === 'owner');
    else if (filter === 'recommended') remote = remote.filter(i => i.trust_level === 'recommended');
    else if (filter === 'normal') remote = remote.filter(i => !i.trust_level || i.trust_level === 'normal');
    else if (filter === 'blocked') remote = remote.filter(i => i.trust_level === 'blocked');

    // Tag filtering
    if (selectedTag) {
      remote = remote.filter(i => i.tags && i.tags.split(',').map(t => t.trim()).includes(selectedTag));
    }

    // Message counts per identity
    const msgCounts = {};
    const rows = sqlite.prepare(`
      SELECT sender_identity_id as sid, COUNT(*) as cnt FROM messages
      WHERE direction='inbound' GROUP BY sender_identity_id
    `).all();
    for (const r of rows) msgCounts[r.sid] = r.cnt;

    // Conversation IDs per remote identity (for linking)
    const convLinks = {};
    const convRows = sqlite.prepare(`
      SELECT remote_identity_id as rid, id as conv_id FROM conversations
      WHERE remote_identity_id IS NOT NULL
      ORDER BY last_message_at DESC
    `).all();
    for (const r of convRows) {
      if (!convLinks[r.rid]) convLinks[r.rid] = r.conv_id;
    }

    // Collect all known tags with counts
    const tagCounts = {};
    all.forEach(i => {
      if (i.tags) i.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      });
    });
    const knownTags = Object.keys(tagCounts).sort();

    return reply.view('identities', { local, remote, msgCounts, convLinks, filter, knownTags, tagCounts, relayNodes, selectedAccount, selectedTag, t, lang, dir, langs });
  });

  // Update identity (display name, notes, trust level)
  fastify.post('/identities/:id', async (request, reply) => {
    const { display_name, notes, tags, trust_level } = request.body;
    await updateIdentity(request.params.id, {
      displayName: display_name,
      notes,
      tags,
      trustLevel: TRUST_LEVELS.includes(trust_level) ? trust_level : undefined,
    });
    return reply.redirect('/identities');
  });

  // Set trust level
  fastify.post('/identities/:id/trust', async (request, reply) => {
    const { trust_level } = request.body;
    if (TRUST_LEVELS.includes(trust_level)) {
      await setTrustLevel(request.params.id, trust_level);
    }
    return reply.redirect('/identities');
  });

  // Toggle block (legacy compat + quick action)
  fastify.post('/identities/:id/block', async (request, reply) => {
    const identity = await getIdentityById(request.params.id);
    if (identity) {
      const newLevel = identity.trust_level === 'blocked' ? 'normal' : 'blocked';
      await setTrustLevel(request.params.id, newLevel);
    }
    return reply.redirect('/identities');
  });

  // Add contact manually
  fastify.post('/identities', async (request, reply) => {
    const { address, display_name, network, notes, trust_level } = request.body;
    if (!address?.trim()) return reply.redirect('/identities');
    await upsertIdentity({
      network: network || 'mainnet',
      address: address.trim(),
      displayName: display_name?.trim() || null,
      identityType: 'remote',
    });
    const identity = await getIdentityByAddress(network || 'mainnet', address.trim());
    if (identity) {
      const updates = {};
      if (notes?.trim()) updates.notes = notes.trim();
      if (TRUST_LEVELS.includes(trust_level)) updates.trustLevel = trust_level;
      if (Object.keys(updates).length) await updateIdentity(identity.id, updates);
    }
    return reply.redirect('/identities');
  });

  // Delete a tag from all identities
  fastify.post('/identities/tags/delete', async (request, reply) => {
    const { tag } = request.body;
    if (!tag?.trim()) return reply.redirect('/identities');
    const target = tag.trim();
    const rows = sqlite.prepare("SELECT id, tags FROM identities WHERE tags LIKE ?").all(`%${target}%`);
    for (const row of rows) {
      const updated = row.tags.split(',').map(t => t.trim()).filter(t => t && t !== target).join(',');
      sqlite.prepare('UPDATE identities SET tags=? WHERE id=?').run(updated || null, row.id);
    }
    return reply.redirect('/identities');
  });

  // Rename a tag across all identities
  fastify.post('/identities/tags/rename', async (request, reply) => {
    const { old_tag, new_tag } = request.body;
    if (!old_tag?.trim() || !new_tag?.trim()) return reply.redirect('/identities');
    const oldName = old_tag.trim();
    const newName = new_tag.trim().toLowerCase().replace(/[^a-z0-9_\u4e00-\u9fff]/g, '');
    if (!newName || oldName === newName) return reply.redirect('/identities');
    const rows = sqlite.prepare("SELECT id, tags FROM identities WHERE tags LIKE ?").all(`%${oldName}%`);
    for (const row of rows) {
      const tags = row.tags.split(',').map(t => t.trim()).filter(Boolean);
      const updated = tags.map(t => t === oldName ? newName : t);
      // deduplicate
      const unique = [...new Set(updated)].join(',');
      sqlite.prepare('UPDATE identities SET tags=? WHERE id=?').run(unique || null, row.id);
    }
    return reply.redirect('/identities');
  });

  // --- API endpoints (for Relay / Adapter / Agent) ---

  // Check if address is blocked
  fastify.get('/api/identity/blocked', async (request, reply) => {
    const { network, address } = request.query;
    if (!address) return reply.send({ blocked: false });
    const blocked = await isAddressBlocked(network || 'mainnet', address);
    return reply.send({ blocked });
  });

  // Blocklist for Relay bulk load
  fastify.get('/api/identity/blocklist', async (request, reply) => {
    const { network } = request.query;
    const list = await listBlockedAddresses(network || 'mainnet');
    return reply.send(list.map(r => r.address));
  });

  // Get trust level for an address (for Adapter/Agent policy decisions)
  fastify.get('/api/identity/trust', async (request, reply) => {
    const { network, address } = request.query;
    if (!address) return reply.send({ trust_level: 'unknown' });
    const level = await getAddressTrustLevel(network || 'mainnet', address);
    return reply.send({ trust_level: level });
  });

  // Agent annotate endpoint — auto-inject tags/notes/trust
  fastify.post('/api/identity/:id/annotate', async (request, reply) => {
    const { tags, notes, trust_level } = request.body || {};
    const ok = await annotateIdentity(request.params.id, {
      tags, notes,
      trustLevel: TRUST_LEVELS.includes(trust_level) ? trust_level : undefined,
    });
    return reply.send({ ok });
  });

  // Agent annotate by address (more convenient)
  fastify.post('/api/identity/annotate', async (request, reply) => {
    const { network, address, tags, notes, trust_level } = request.body || {};
    if (!address) return reply.send({ ok: false, error: 'address required' });
    const identity = await getIdentityByAddress(network || 'mainnet', address);
    if (!identity) return reply.send({ ok: false, error: 'identity not found' });
    const ok = await annotateIdentity(identity.id, {
      tags, notes,
      trustLevel: TRUST_LEVELS.includes(trust_level) ? trust_level : undefined,
    });
    return reply.send({ ok });
  });
}
  // ── ① U1/A2 委员身份注册入口 (2026-08-18, J2; 设计报告 §1 + §9-bis, 已过 J1 审席 + NWT 两轮红队) ──
  //
  // 🔴 **handler 只做三件事, 不做任何业务判断** —— 判断全在模块内, 那是 §6-1 定义冻结的前提:
  //    ① 取 console 单例 sqlite handle(与 relay_nodes / 两张 u1 表同一个 handle、同一个库文件)
  //    ② createChallengeStore(sqlite, CANONICAL_CHALLENGE_TABLE)
  //    ③ registerIdentity({ sqlite, submission, challengeStore })
  //
  // 🔴 **硬纪律一: 禁止把 req.body 展开进 args/submission。** 必须逐字段显式取。
  //    理由不是洁癖: (366) 那个洞的形态正是"调用方塞一个同名字段"。任何 `...req.body` /
  //    `Object.assign(.., req.body)` 都会把它原样重开 —— 而 `registerIdentity` 的生产签名里
  //    **刻意不存在** clock / verifyMessageFn / expectedTable 这些参数名, 展开就等于把它们送回来。
  //    ⚠ **别名与计算属性同样算展开**(`const b=req.body; {...b}` / `req['bo'+'dy']`) ——
  //      负面 grep 只是必要条件, 真正的背书是 ①-3/①-4/①-5 那三条**行为注入测**。
  //
  // 🔴 **硬纪律二: handler 不碰 u1_identity_challenge / u1_identity_registration 两张表。**
  //    读写权归模块(store 是动词式导出, (376) 之后不再交出 ops 对象)。
  //
  // 🔵 **白名单是六个字段, 不是五个**: 我设计稿 §1 只列了 `u1-registration.mjs` 自己读的五个,
  //    **漏了 `signature`** —— 它由 `u1-registration-pop.mjs` 从**同一个 submission** 读(`:84`/`:129`)。
  //    照五字段实现会让每次注册都 `MALFORMED: signature missing`。**实现时才暴露的设计错, 记在这里。**
  fastify.post('/api/identity/u1-register', async (request, reply) => {
    const b = request.body || {};
    const submission = {
      relayId: b.relayId,
      rootXpub: b.rootXpub,
      identityIndex: b.identityIndex,
      identityPubkeyXOnly: b.identityPubkeyXOnly,
      challenge: b.challenge,
      signature: b.signature,
    };

    // 🔴 fail-closed 传导: 迁移未跑(表不存在)时工厂必抛 ⇒ 这里**必须**回明确失败,
    //    **绝不**能吞掉异常后继续走, 更不能返回"注册成功"。
    let challengeStore;
    try {
      challengeStore = createChallengeStore(sqlite, CANONICAL_CHALLENGE_TABLE);
    } catch (e) {
      return reply.code(503).send({
        ok: false,
        code: 'CHALLENGE_STORE_UNAVAILABLE',
        reason: `一次性挑战存储不可用(通常是 v197 迁移尚未在本库跑过): ${e.message}`,
      });
    }

    const result = await registerIdentity({ sqlite, submission, challengeStore });
    return reply.code(result.ok ? 200 : 400).send(result);
  });

