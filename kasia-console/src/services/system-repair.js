/**
 * System Repair — 自检诊断 + 自动修复
 *
 * Agent 的 system_status 技能和 conversational-ops 共用此模块。
 * 检测系统各组件状态，返回问题列表和可执行的修复动作。
 *
 * 设计原则：
 * - 诊断和修复逻辑在 Console 一处，不散落在 Mind 技能里
 * - 修复动作都是幂等的（多次执行不出错）
 * - 只修能修的，不能修的如实报告
 */
import { getConfig, setConfig } from '../data/settings/configs.js';
import { getWorkingRpc, isLocalNode, invalidateCache } from './rpc-health.js';
import { startScanner, stopScanner, getScannerStatus } from './scanner.js';
import { getStatus as getRelayStatus } from './relay-manager.js';
import net from 'net';

/**
 * TCP ping
 */
function tcpPing(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

/**
 * 诊断全系统，返回问题列表
 *
 * 每个问题：{ id, component, severity, message, fix?, fixLabel? }
 * - severity: 'critical' | 'warning' | 'info'
 * - fix: 可自动修复的 fix ID（传给 applyFix）
 * - fixLabel: 人话描述修复动作
 */
export async function diagnose() {
  const issues = [];

  // ── 1. 节点检测 ──
  const localUp = await tcpPing('127.0.0.1', 17110, 2000);
  const configuredMode = await getConfig('rpc_mode') || 'local';
  const configuredUrl = await getConfig('rpc_url') || '';
  const { url: workingUrl, isLocal: usingLocal } = await getWorkingRpc();

  if (localUp && configuredMode !== 'local') {
    issues.push({
      id: 'node_switch_local',
      component: 'node',
      severity: 'warning',
      message: `本地节点可用 (127.0.0.1:17110) 但当前使用 ${configuredMode} 模式 (${configuredUrl || 'resolver'})`,
      fix: 'switch_to_local',
      fixLabel: '切换到本地节点',
    });
  }

  if (!localUp && configuredMode === 'local') {
    if (workingUrl) {
      issues.push({
        id: 'node_local_down_has_remote',
        component: 'node',
        severity: 'warning',
        message: `本地节点不可用，已自动发现远程节点 ${workingUrl}`,
        fix: 'switch_to_discovered',
        fixLabel: '切换到远程节点',
        fixData: { url: workingUrl },
      });
    } else {
      issues.push({
        id: 'node_all_down',
        component: 'node',
        severity: 'critical',
        message: '本地节点不可用，也未找到可用远程节点',
      });
    }
  }

  if (!localUp && configuredMode !== 'local' && !workingUrl) {
    issues.push({
      id: 'node_unreachable',
      component: 'node',
      severity: 'critical',
      message: `配置的节点 ${configuredUrl || 'resolver'} 不可达，无可用节点`,
      fix: 'discover_node',
      fixLabel: '重新发现可用节点',
    });
  }

  // ── 2. Scout 检测 ──
  const scannerStatus = getScannerStatus();
  const scannerRunning = !!scannerStatus?.running;
  const scannerEnabled = (await getConfig('scanner_enabled')) === 'true';

  if (localUp && scannerEnabled && !scannerRunning) {
    issues.push({
      id: 'scout_should_run',
      component: 'scout',
      severity: 'warning',
      message: 'Scout 已启用但未运行（本地节点可用）',
      fix: 'start_scout',
      fixLabel: '启动 Scout',
    });
  }

  if (!localUp && scannerRunning) {
    issues.push({
      id: 'scout_no_local',
      component: 'scout',
      severity: 'warning',
      message: 'Scout 在运行但无本地节点，扫链走远程节点浪费公共资源',
      fix: 'stop_scout',
      fixLabel: '停止 Scout',
    });
  }

  if (!localUp && !scannerRunning && scannerEnabled) {
    issues.push({
      id: 'scout_needs_local',
      component: 'scout',
      severity: 'info',
      message: 'Scout 需要本地节点才能运行，当前无本地节点',
    });
  }

  // ── 3. Adapter 检测 ──
  const { sqlite } = await import('../db/client.js');
  const adapters = sqlite.prepare('SELECT id, name, http_port FROM adapter_nodes').all();
  for (const a of adapters) {
    if (!a.http_port) continue;
    const up = await tcpPing('127.0.0.1', a.http_port, 2000);
    if (!up) {
      issues.push({
        id: `adapter_down_${a.id}`,
        component: 'adapter',
        severity: 'critical',
        message: `Adapter "${a.name}" (端口 ${a.http_port}) 不可达 — Agent 无法思考`,
      });
      // Adapter 没有自动重启 API，只能报告
    }
  }

  // ── 4. Relay 检测 ──
  const relayStatusArr = getRelayStatus();
  const relayRunningIds = new Set(relayStatusArr.map(rs => rs.relayNodeId));
  const relayNodes = sqlite.prepare('SELECT id, name FROM relay_nodes WHERE address IS NOT NULL').all();
  for (const r of relayNodes) {
    if (!relayRunningIds.has(r.id)) {
      issues.push({
        id: `relay_down_${r.id}`,
        component: 'relay',
        severity: 'critical',
        message: `Relay "${r.name}" 未运行 — Agent 无法收发消息`,
        fix: `restart_relay_${r.id}`,
        fixLabel: `重启 Relay "${r.name}"`,
        fixData: { relayId: r.id },
      });
    }
  }

  // ── 5. 整体评分 ──
  const critical = issues.filter(i => i.severity === 'critical').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const status = critical > 0 ? 'critical' : warnings > 0 ? 'degraded' : 'healthy';

  return { status, issues, ts: new Date().toISOString() };
}

/**
 * 执行修复动作
 * @param {string} fixId — diagnose() 返回的 fix ID
 * @param {object} fixData — 附加数据
 * @returns {{ ok: boolean, message: string }}
 */
export async function applyFix(fixId, fixData = {}) {
  switch (fixId) {
    case 'switch_to_local': {
      await setConfig('rpc_mode', 'local', { category: 'node' });
      await setConfig('rpc_url', 'ws://127.0.0.1:17110', { category: 'node' });
      invalidateCache();
      return { ok: true, message: '已切换到本地节点 ws://127.0.0.1:17110' };
    }

    case 'switch_to_discovered': {
      const url = fixData.url;
      if (!url) return { ok: false, message: '无可用远程节点 URL' };
      await setConfig('rpc_mode', 'discovered', { category: 'node' });
      await setConfig('rpc_url', url, { category: 'node' });
      invalidateCache();
      return { ok: true, message: `已切换到远程节点 ${url}` };
    }

    case 'discover_node': {
      invalidateCache();
      const { url } = await getWorkingRpc();
      if (!url) return { ok: false, message: '未发现可用节点' };
      await setConfig('rpc_mode', 'discovered', { category: 'node' });
      await setConfig('rpc_url', url, { category: 'node' });
      return { ok: true, message: `发现并切换到 ${url}` };
    }

    case 'start_scout': {
      const result = await startScanner();
      return result.ok
        ? { ok: true, message: `Scout 已启动 (PID ${result.pid})` }
        : { ok: false, message: `启动失败: ${result.reason}` };
    }

    case 'stop_scout': {
      const result = await stopScanner();
      return result.ok
        ? { ok: true, message: 'Scout 已停止' }
        : { ok: false, message: `停止失败: ${result.reason}` };
    }

    default: {
      // relay restart: restart_relay_{id}
      if (fixId.startsWith('restart_relay_')) {
        const relayId = fixData.relayId || fixId.replace('restart_relay_', '');
        try {
          const { startRelay } = await import('./relay-manager.js');
          const result = await startRelay(relayId);
          return result.ok
            ? { ok: true, message: `Relay 已重启 (PID ${result.pid})` }
            : { ok: false, message: `重启失败: ${result.reason}` };
        } catch (e) {
          return { ok: false, message: `重启异常: ${e.message}` };
        }
      }
      return { ok: false, message: `未知修复动作: ${fixId}` };
    }
  }
}
