/**
 * Self-Healing — Agent 自修复与互助诊断。
 *
 * 由 mind-manager.js 健康检查循环调用（每 30 分钟），不走常规技能激活。
 *
 * 三个方法：
 *   silentRepair()           — 黄色状态：不调 Brain，静默修复
 *   emergencyRepair()        — 红色状态：暂停行为 + 静默修复 + 重启 Adapter
 *   notifyOwnerAboutPeer()   — 同伴红色：调 Brain 生成通知（4h 冷却防骚扰）
 *
 * 所有修复动作通过 callbacks 执行，不直接 import Console 服务。
 * 这样 self-healing 只做决策，不耦合具体实现。
 */

// ── 同伴通知防重复 ──────────────────────────────────────────────────────
const _notifiedPeers = {};   // { peerName: lastNotifiedAt }
const NOTIFY_COOLDOWN = 4 * 3600_000; // 4 小时内不重复通知

/**
 * silentRepair — 黄色状态，静默修复，不调 Brain。
 *
 * @param {string} agentName
 * @param {object} indicators  { adapter, lastEvent, proactive, reflection, errors, blocks, payFails }
 * @param {object} callbacks   { triggerReflection, cleanupGoals }
 * @returns {string[]} 执行的修复动作列表
 */
export function silentRepair(agentName, indicators, callbacks) {
  const actions = [];

  if (indicators.reflection === 'yellow' || indicators.reflection === 'red') {
    try {
      callbacks.triggerReflection(agentName);
      actions.push('trigger_reflection');
    } catch (err) {
      console.log(`[self-healing] ${agentName} reflection trigger failed: ${err.message}`);
    }
  }

  if (indicators.blocks === 'yellow' || indicators.blocks === 'red') {
    try {
      callbacks.cleanupGoals(agentName);
      actions.push('cleanup_goals');
    } catch (err) {
      console.log(`[self-healing] ${agentName} goal cleanup failed: ${err.message}`);
    }
  }

  if (actions.length > 0) {
    console.log(`[self-healing] ${agentName} silent repair: ${actions.join(', ')}`);
  }

  return actions;
}

/**
 * emergencyRepair — 红色状态，紧急修复。
 *
 * 执行 silentRepair 的所有动作 + Adapter 重启 + 交易暂停。
 *
 * @param {string} agentName
 * @param {object} indicators
 * @param {object} callbacks  { triggerReflection, cleanupGoals, restartAdapter, pauseTrading }
 * @returns {string[]} 执行的修复动作列表
 */
export async function emergencyRepair(agentName, indicators, callbacks) {
  const actions = silentRepair(agentName, indicators, callbacks);

  if (indicators.adapter === 'red') {
    try {
      await callbacks.restartAdapter(agentName);
      actions.push('restart_adapter');
    } catch (err) {
      console.log(`[self-healing] ${agentName} adapter restart failed: ${err.message}`);
    }
  }

  if (indicators.payFails === 'red') {
    try {
      callbacks.pauseTrading(agentName);
      actions.push('pause_trading');
    } catch (err) {
      console.log(`[self-healing] ${agentName} trading pause failed: ${err.message}`);
    }
  }

  if (actions.length > 0) {
    console.log(`[self-healing] ${agentName} EMERGENCY repair: ${actions.join(', ')}`);
  }

  return actions;
}

/**
 * notifyOwnerAboutPeer — 发现同伴红色时通知 Owner。
 *
 * 4 小时冷却：同伴持续红色不会反复通知。
 * 同伴恢复后下次变红重新计时。
 *
 * @param {string} agentName    报告者（发现问题的 Agent）
 * @param {object} peer         { name, status, reason }
 * @param {object} callbacks    { alertOwner(agentName, peer) → Promise }
 * @returns {boolean} 是否发送了通知
 */
export async function notifyOwnerAboutPeer(agentName, peer, callbacks) {
  const last = _notifiedPeers[peer.name] || 0;
  if (Date.now() - last < NOTIFY_COOLDOWN) return false;

  _notifiedPeers[peer.name] = Date.now();

  try {
    await callbacks.alertOwner(agentName, peer);
    console.log(`[self-healing] ${agentName} notified Owner about ${peer.name} (${peer.reason})`);
    return true;
  } catch (err) {
    console.log(`[self-healing] ${agentName} failed to notify about ${peer.name}: ${err.message}`);
    return false;
  }
}

/**
 * clearPeerNotification — 同伴恢复后清除通知记录。
 * 下次变红时可以立即通知。
 */
export function clearPeerNotification(peerName) {
  delete _notifiedPeers[peerName];
}
