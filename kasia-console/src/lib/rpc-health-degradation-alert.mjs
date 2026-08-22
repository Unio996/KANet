// rpc-health-degradation-alert.mjs — 连续 RPC 失败告警(KANet-UI, 2026-07-21, Bettor #utf9ze①派工)
//
// 背景: RpcClient 状态劣化今天复发两次(07:35Z/14:48Z), 第二次冻结 settle-daemon tick 44 分钟才被
// 人肉巡检发现——no-RPC 期间 console HTTP/心跳仍 fresh, 纯靠人盯日志才抓到。本模块补一个自动信号,
// 不再靠"谁记得去查console.log"。
//
// 架构模式照抄同文件夹 settle-failed-alert.mjs(edge-trigger + events 表留痕 + 直接播频道三件套,
// 已验证过的成熟先例, 不另造轮子)——边沿触发(只在"跨过阈值进入劣化态"那一刻报一次, 不是持续
// 劣化期间每 tick 都刷屏), 恢复后自动重新武装(下次再劣化会再报一次)。
//
// 2026-08-22(KANet-UI, Bettor #4jsxdo(612)派工 + #4k4wdm(P1 scoping)审): wasm-trap 无进程内恢复
// 路径(kaspa-wasm 是 Node ESM 缓存的进程级单例, trap 后损坏的是共享 wasm 内存, pool.js/relay.js
// 等 30+ 调用点都是受害者不是病灶, 唯一解法=整进程重启), 而告警本身已跑稳 3 周+(07-21 至今),
// "等告警跑稳再议自动化"的条件已满足 —— 加一层"确诊后自退, 交外部 supervisor 拉起"。
// 🔴 承重安全点(Bettor 审定, 动码前必解): process.exit(1) 前必须先确认 supervisor 活着, 不在
// 就【只播报不自退】——自退后没人拉起比继续带病硬撑更糟(= "自退与 reboot-durable supervisor
// 是耦合的, 别让自退依赖一个可能已死的拉起方")。查活判据见 _isSupervisorAlive(): 用 Get-CimInstance
// 按【进程名=bash.exe + 命令行含脚本路径+_run 参数】匹配, 不用 pidfile(bash 伪 PID ≠ Windows PID,
// 在册 reference-windows-process-tree-attribution-parent-chain 同族坑) ——查询由 Node 直接
// spawn powershell.exe(非经 bash -c 包一层), 结构上不会自匹配(查询进程是 powershell.exe, 谓词
// 只认 bash.exe, 亲测验证过: 经 bash 包装跑同一谓词会自匹配"四命中全是自己"经典坑, 直接 spawn
// 则 0 命中匹配 spawn 时 supervisor 实际未在跑的真实状态)。查询本身出错/超时 = fail-closed 判
// "未确认活着", 同"不在"处理, 不自退。
import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';
import { execFile } from 'node:child_process';

const TICK_INTERVAL_MS = Number(process.env.RPC_HEALTH_ALERT_TICK_MS) || 60_000; // 1min
const STARTUP_GRACE_MS = 30_000;
const WINDOW_MINUTES = Number(process.env.RPC_HEALTH_ALERT_WINDOW_MIN) || 3; // 统计过去几分钟内的失败次数
const FAIL_THRESHOLD = Number(process.env.RPC_HEALTH_ALERT_THRESHOLD) || 5; // 窗口内达到几次判定"真劣化"非瞬时抖动
// 自退开关: 默认关闭(=0), 需显式 opt-in(RPC_HEALTH_SELF_RESTART=1) 才启用 —— 落地当天先只跑
// 告警+supervisor活性判据本身的验证, 自退动作本身单独拿 Bettor sign-off 后再开(铁律0: 报计划
// 不等于报完就自动获得"动作"授权, "诊断"和"动作"是两个闸)。
const SELF_RESTART_ENABLED = process.env.RPC_HEALTH_SELF_RESTART === '1';
// 确诊阈值: 保守, 宁可晚退不可误退(Bettor 审定原话)。默认 10min ——比 WINDOW_MINUTES(3min) 的告警
// 滚动窗口宽得多, 排除"单个 tick 的滚动窗口噪声", 也远小于历史真实故障时长量级(44min 冻结/~5h 周期),
// 显著收紧暴露窗但不会对瞬时抖动反应过度。
const SELF_RESTART_CONFIRM_MS = Number(process.env.RPC_HEALTH_SELF_RESTART_CONFIRM_MS) || 10 * 60 * 1000;
const SUPERVISOR_CHECK_TIMEOUT_MS = 5_000;
// Codex 卡③(2026-08-03, D-012 §6-2 挂账): 水位线只堵死了"同一批旧数据被重报"(2026-08-03
// 01:26/01:28 那种重启场景), 没堵住"同一个未中断的劣化 episode 里持续冒出新失败行, 每个都比水位线
// 新一点, 于是每 tick 都重新算作'新数据'并重报"——实测坐实: 一个连续 6-tick 的持续劣化(每 tick 多
// 一行新失败)会开 6 次 channel post, 而不是边沿触发该有的 1 次。冷却期把"有没有新数据"(水位线,
// 决定跨重启去重)和"该不该现在就再吵一次"(冷却期,决定持续劣化期间的播报频率)分成两个独立判据。
const COOLDOWN_MS = Number(process.env.RPC_HEALTH_ALERT_COOLDOWN_MS) || 30 * 60 * 1000; // 30min
const ALERT_RELAY_ID = process.env.RPC_HEALTH_ALERT_RELAY_ID || 'f5cf6d85-58f4-4991-9cd5-7c6779f6822b'; // KANet-UI-tn
const ALERT_CHANNEL = process.env.RPC_HEALTH_ALERT_CHANNEL || 'dev-coord-testnet';
const CONSOLE_BASE = process.env.RPC_HEALTH_ALERT_CONSOLE_BASE || 'http://127.0.0.1:3200';
const FETCH_TIMEOUT_MS = 15_000;

let timer = null;
let running = false;

// (126) 待认领项落地: 原实现的边沿触发状态是一个纯内存布尔(_alerting), console 崩溃重启即归零——
// 但 events 表里崩溃前那批失败行还在, 且仍落在新进程第一 tick 的 WINDOW_MINUTES 回看窗内, 于是被
// 当成"新一轮劣化"重报一次(2026-08-03 01:26/01:28 实况, KANet-UI 事后核实坐实)。
//
// 修法: 布尔换成"水位线"—— 记住"已经报过警、报到哪一行为止"(用 events 表原生 rowid, 单调递增、
// 不受进程重启影响、不受同秒时间戳精度撞车影响), 而不是"报过没报过"这一个bit。
//   _lastSeenMaxFailRowid: 当前认为"已经算过账"的最新失败行 rowid; null = 不在劣化episode里。
//   _dbWatermarkChecked:   本进程是否已经从 DB 读过一次历史水位线(每个进程生命周期只读一次,
//                          避免"真的已恢复、这次是全新劣化"时又被一条早就翻篇的旧 DB 记录挡住)。
// 效果三态全对: ①同进程内连续 tick、数据没变 → 水位线内存里就有, 直接挡, 不查库(原语义不变);
// ②进程重启、数据没变(本次事故实况) → 内存水位线是空的但没 recover 过 → 查库拿回上次水位线,
//   发现没有新数据 → 挡; ③进程重启后数据仍在继续恶化(新失败行 rowid 更高)→ 水位线追上但放行,
//   不会被"曾经报过"这件事永久挡死。
let _lastSeenMaxFailRowid = null;
let _dbWatermarkChecked = false;
// 冷却期水位线(与上面的 rowid 水位线是两件不同的事, 别合并): rowid 水位线答"有没有新数据"
// (决定跨重启去重), _lastAlertPostedAt 答"该不该现在就再吵一次"(决定持续劣化期间的播报频率)。
// 同样冷启动只从 DB 读一次(复用 _dbWatermarkChecked 这个标记, 两条水位线一起冷启动一起补)。
let _lastAlertPostedAt = null;
// 本次(未中断)劣化 episode 的起点(ms epoch, 取当次首次跨阈值 tick 的窗口内最早一条失败行
// created_at 近似) — 与上面两条水位线同一套冷启动纪律: 只在 _episodeStartedAt 仍为 null 时
// 赋值(同进程内跨 tick 不重算), 从 DB 的上一条 onset 事件 payload 里带回(跨重启不丢), 恢复
// (count===0)时清空。J2 06:42 指出同一句"已知修法:重启console"盖住了三种不同现象(计时器噪声/
// 真故障/瞬时抖动), Bettor 批复(#mvcezr.2)方向对但要求 diff 附三种现象各自输出——见本文件同批
// commit message, 这里只加"恢复"边沿事件本身。
let _episodeStartedAt = null;
// 本 episode 是否已尝试过自退——只尝试一次(成功则进程退出, 这个变量随进程消失重置为 false;
// 失败/supervisor 未确认活着时也标记, 防止同一 episode 每个 tick 都重跑一次 powershell 查活)。
let _selfRestartAttemptedForEpisode = false;

function _formatDuration(ms) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}秒`;
  const totalMin = Math.round(totalSec / 60);
  if (totalMin < 60) return `${totalMin}分钟`;
  return `${Math.floor(totalMin / 60)}小时${totalMin % 60}分钟`;
}

function _lastAlertedPostedAt() {
  try {
    const row = sqlite.prepare(`
      SELECT created_at FROM events
       WHERE event_type = 'rpc_health_degraded_onset'
       ORDER BY rowid DESC LIMIT 1
    `).get();
    return row ? new Date(row.created_at + 'Z').getTime() : null; // SQLite datetime('now') 是 UTC, 补 Z 防本地时区误解析
  } catch { return null; }
}

function _writeAlertEvent(summary, count, maxFailRowid, episodeStartedAt) {
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', 'rpc_health_degraded_onset', 'rpc-health-degradation-alert', 'error', ?, ?, datetime('now'))
    `).run(randomUUID(), summary, JSON.stringify({ windowMinutes: WINDOW_MINUTES, failCount: count, threshold: FAIL_THRESHOLD, maxFailRowid, episodeStartedAt }));
  } catch (e) { console.warn(`[rpc-health-degradation-alert] events insert fail (non-fatal): ${e.message}`); }
}

// 边沿触发②(新增): episode 从劣化回落到 count===0 时报一次, 带真实持续时长——不是判据, 纯信息,
// 不影响任何门控。event_type 与 onset 分开(rpc_health_recovered vs rpc_health_degraded_onset),
// 不吃 onset 那条 events.n===3 的既有回归断言。
function _writeRecoveryEvent(summary, durationMs) {
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', 'rpc_health_recovered', 'rpc-health-degradation-alert', 'info', ?, ?, datetime('now'))
    `).run(randomUUID(), summary, JSON.stringify({ durationMs }));
  } catch (e) { console.warn(`[rpc-health-degradation-alert] recovery event insert fail (non-fatal): ${e.message}`); }
}

function _lastAlertedMaxFailRowid() {
  try {
    const row = sqlite.prepare(`
      SELECT payload_json FROM events
       WHERE event_type = 'rpc_health_degraded_onset'
       ORDER BY rowid DESC LIMIT 1
    `).get();
    if (!row) return null;
    const parsed = JSON.parse(row.payload_json || '{}');
    return typeof parsed.maxFailRowid === 'number' ? parsed.maxFailRowid : null;
  } catch { return null; }
}

function _lastAlertedEpisodeStartedAt() {
  try {
    const row = sqlite.prepare(`
      SELECT payload_json FROM events
       WHERE event_type = 'rpc_health_degraded_onset'
       ORDER BY rowid DESC LIMIT 1
    `).get();
    if (!row) return null;
    const parsed = JSON.parse(row.payload_json || '{}');
    return typeof parsed.episodeStartedAt === 'number' ? parsed.episodeStartedAt : null;
  } catch { return null; }
}

/**
 * supervisor 是否活着——只信 Get-CimInstance 按【进程名+命令行内容】匹配, 不信 pidfile 数字
 * (bash 伪 PID ≠ Windows PID, 在册坑)。Node 直接 spawn powershell.exe, 不经 bash -c 包一层,
 * 结构上不会自匹配(本查询进程是 powershell.exe, 谓词只认 bash.exe)。
 * 任何异常(spawn 失败/超时/解析失败)一律 fail-closed 返回 false ——"未确认活着"当"不在"处理,
 * 宁可漏一次该退的退, 不可在 supervisor 实际已死时还自退把 console 拉没了。
 */
export function _isSupervisorAlive() {
  return new Promise((resolve) => {
    const psCmd = "(Get-CimInstance Win32_Process -Filter \"Name='bash.exe'\" | " +
      "Where-Object { $_.CommandLine -like '*kanet-console-supervisor.sh*' -and $_.CommandLine -like '*_run*' } " +
      "| Measure-Object).Count";
    let settled = false;
    const child = execFile('powershell.exe', ['-NoProfile', '-Command', psCmd],
      { timeout: SUPERVISOR_CHECK_TIMEOUT_MS, windowsHide: true },
      (err, stdout) => {
        if (settled) return;
        settled = true;
        if (err) {
          console.warn(`[rpc-health-degradation-alert] supervisor liveness check failed (fail-closed → treat as not-confirmed-alive): ${err.message}`);
          return resolve(false);
        }
        const count = parseInt(String(stdout).trim(), 10);
        resolve(Number.isFinite(count) && count > 0);
      });
    child.on('error', () => { if (!settled) { settled = true; resolve(false); } });
  });
}

/**
 * 确诊后自退: episode 持续超过 SELF_RESTART_CONFIRM_MS(保守阈值, 排除单窗口噪声)仍未恢复
 * → 先核 supervisor 活着(fail-closed) → 活着才 process.exit(1)(干净退出, 交 supervisor 按
 * kanet-start-headless 序列拉起); 不在/未确认 → 只播报升级告警, 不自退(自退与 reboot-durable
 * supervisor 耦合, 别让自退依赖一个可能已死的拉起方)。每 episode 只尝试一次。
 */
async function _maybeSelfRestart(episodeStartedAt, count) {
  if (!SELF_RESTART_ENABLED) return;
  if (_selfRestartAttemptedForEpisode) return;
  const sustainedMs = Date.now() - episodeStartedAt;
  if (sustainedMs < SELF_RESTART_CONFIRM_MS) return;

  _selfRestartAttemptedForEpisode = true;
  const alive = await _isSupervisorAlive();
  if (!alive) {
    const msg = `🔴🔴【rpc-health-degradation-alert·自退升级】RPC 劣化已持续 ${_formatDuration(sustainedMs)}(${count} 次失败/${WINDOW_MINUTES}min 窗口), 已达自退确诊阈值, 但 supervisor 未确认活着 ⇒ 不自退(自退无人拉起更糟)。需要人工重启 console。`;
    console.error(`[rpc-health-degradation-alert] SUSTAINED DEGRADED ${_formatDuration(sustainedMs)}, supervisor NOT confirmed alive — withholding self-restart, manual action needed`);
    await _postToChannel(msg);
    return;
  }

  const msg = `🔴【rpc-health-degradation-alert·自退】RPC 劣化已持续 ${_formatDuration(sustainedMs)}, supervisor 已确认活着, console 即将 process.exit(1) 自退, 交 supervisor 按现有序列拉起(pid=${process.pid}, ts=${new Date().toISOString()})。`;
  console.error(`[rpc-health-degradation-alert] SUSTAINED DEGRADED ${_formatDuration(sustainedMs)}, supervisor alive — self-restarting now (pid=${process.pid})`);
  await _postToChannel(msg);
  process.exit(1);
}

async function _postToChannel(text) {
  try {
    const ctrl = new AbortController();
    const timer2 = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    await fetch(`${CONSOLE_BASE}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayId: ALERT_RELAY_ID, channel: ALERT_CHANNEL, message: text }),
      signal: ctrl.signal,
    }).catch((e) => console.warn(`[rpc-health-degradation-alert] channel post fail (non-fatal): ${e.message}`));
    clearTimeout(timer2);
  } catch (e) { console.warn(`[rpc-health-degradation-alert] channel post fail (non-fatal): ${e.message}`); }
}

export async function rpcHealthAlertTick() {
  if (running) return { skipped: true };
  running = true;
  try {
    const row = sqlite.prepare(`
      SELECT COUNT(*) AS n, MAX(rowid) AS maxRowid, MIN(created_at) AS minCreatedAt FROM events
       WHERE event_type = 'rpc_health_check_failed' AND created_at > datetime('now', ?)
    `).get(`-${WINDOW_MINUTES} minutes`);
    const count = row?.n || 0;

    if (count >= FAIL_THRESHOLD) {
      // 进程生命周期内只查一次 DB(冷启动补内存的空缺, 三条水位线一起补); 之后全程只信内存, 便宜且够用。
      if (_lastSeenMaxFailRowid === null && !_dbWatermarkChecked) {
        _lastSeenMaxFailRowid = _lastAlertedMaxFailRowid();
        _lastAlertPostedAt = _lastAlertedPostedAt();
        _episodeStartedAt = _lastAlertedEpisodeStartedAt();
      }
      _dbWatermarkChecked = true;
      // 仍为 null ⇒ 真·全新 episode(冷启动无历史 或 上次已恢复清空过)——只在这里赋值一次, 同
      // episode 内后续 tick 不再改写(近似值: 取本次窗口内最早一条失败行的时间, 而非精确的"第一次
      // 跨阈值那一刻", 窗口只有 WINDOW_MINUTES 分钟, 精度足够报持续时长用)。
      if (_episodeStartedAt === null) {
        _episodeStartedAt = row.minCreatedAt ? new Date(row.minCreatedAt + 'Z').getTime() : Date.now();
      }

      // 自退判断跑在每个"仍然劣化"的 tick 上, 不受下面 hasNewData/冷却期短路影响——它问的是
      // "这个 episode 持续了多久", 不是"该不该再吵频道一次"(两件事故意分开判, 同 alert 冷却期
      // 与 rowid 水位线分离的既有设计)。process.exit(1) 会在满足条件时直接终止本函数往下执行。
      await _maybeSelfRestart(_episodeStartedAt, count);

      const maxFailRowid = row.maxRowid;
      const hasNewData = !(_lastSeenMaxFailRowid != null && maxFailRowid != null && maxFailRowid <= _lastSeenMaxFailRowid);
      if (!hasNewData) {
        // 没有比"上次算过账"的那一行更新的失败——同一批数据(不管是同进程还是跨重启看到的), 不重报。
        return { ok: true, degraded: true, alreadyAlerted: true, count };
      }

      // 有新数据(可能是全新 episode, 也可能是同一个未中断 episode 里持续冒出的新失败行)——水位线
      // 无论如何都要往前追, 否则下次比较基准是错的; 但"追了水位线"和"该不该真的再吵频道一次"分开判。
      _lastSeenMaxFailRowid = maxFailRowid;
      const now = Date.now();
      const inCooldown = _lastAlertPostedAt != null && (now - _lastAlertPostedAt) < COOLDOWN_MS;
      if (inCooldown) {
        console.warn(`[rpc-health-degradation-alert] DEGRADED (still, within ${COOLDOWN_MS / 60000}min cooldown, not re-posting): ${count} failures in ${WINDOW_MINUTES}min`);
        return { ok: true, degraded: true, count, suppressedByCooldown: true };
      }

      _lastAlertPostedAt = now;
      // 2026-08-10 改法(J2 #mv6io2.4 指出/Bettor #mvcezr.2 批): 不再在 onset 时点断言"已知修法:
      // 重启console"——同一句话盖住了三种不同现象(阈值噪声/真故障/瞬时抖动)。保留"重启是已验证过
      // 的修法"这条信息本身(不能丢, 否则真故障那种场景的读者少了行动指引), 但把"现在就该重启"这个
      // 判断权交给持续时长: 会补发一条带真实持续时长的"已恢复"播报; 迟迟不来才是该重启的信号。
      // 🔴 措辞刻意不写"数秒~数十秒内自愈"——count 是过去 WINDOW_MINUTES 分钟的滚动窗口计数, 不是
      // 瞬时状态: 哪怕真实故障只有 6 秒(04:58 那次实况), 那批失败行仍会持续留在窗口里直到它们各自
      // 过期, 恢复播报最快也要等约 WINDOW_MINUTES 分钟后才会出现——文案必须诚实标这个滞后, 否则读者
      // 会拿"已恢复播报"的到达时刻直接当真实故障时长用(下面 summary 原样带出这句)。
      const summary = `过去${WINDOW_MINUTES}分钟内 getWorkingRpc() 连续失败 ${count} 次(阈值${FAIL_THRESHOLD})— RpcClient 疑似进入劣化态, 结算/下注等所有需要RPC的路径可能受影响。是否需要重启视持续时长而定: 会补发一条带持续时长的"已恢复"播报(受滚动窗口影响, 该播报最快约${WINDOW_MINUTES}分钟后才会出现, 时长数字也会比真实故障多出这一截——几分钟内到达优先判定为瞬时抖动); 迟迟不见恢复播报, 按已验证过的修法重启console。`;
      console.warn(`[rpc-health-degradation-alert] DEGRADED: ${count} failures in ${WINDOW_MINUTES}min`);
      _writeAlertEvent(summary, count, maxFailRowid, _episodeStartedAt);
      await _postToChannel(`🔴【rpc-health-degradation-alert·自动监控】RPC疑似劣化\n${summary}`);
      return { ok: true, degraded: true, count };
    }

    // 恢复(低于阈值)— 复位三条水位线(rowid + 冷却期 + episode起点), 下次再劣化 = 全新 episode,
    // 立即报警不用等冷却期(但不重置 _dbWatermarkChecked: 本进程已经知道自己不是刚冷启动)。
    if (count === 0) {
      // 边沿触发②: 只在"这次 episode 确实报过 onset"时才补发恢复播报(_lastAlertPostedAt 非 null
      // = 至少 posted 过一次, 不管是否被冷却期挡过后续追加播报)——避免在"从未真的进入过劣化播报"
      // 的边界上凭空报一条恢复。
      if (_episodeStartedAt !== null && _lastAlertPostedAt !== null) {
        const durationMs = Date.now() - _episodeStartedAt;
        const durationText = _formatDuration(durationMs);
        const summary = `RPC 劣化已自愈, 本次持续 ${durationText}(滚动窗口检测口径, 含约${WINDOW_MINUTES}分钟固定滞后——真实故障时长可能比这个数字短; 用于分辨"几分钟量级的瞬时抖动"vs"几十分钟以上的真故障", 不做秒级精度)。`;
        console.warn(`[rpc-health-degradation-alert] RECOVERED: duration=${durationText}`);
        _writeRecoveryEvent(summary, durationMs);
        await _postToChannel(`✅【rpc-health-degradation-alert·自动监控】RPC已恢复\n${summary}`);
      }
      if (_lastSeenMaxFailRowid !== null) _lastSeenMaxFailRowid = null;
      if (_lastAlertPostedAt !== null) _lastAlertPostedAt = null;
      _episodeStartedAt = null;
      _selfRestartAttemptedForEpisode = false;
    }
    return { ok: true, degraded: false, count };
  } catch (e) {
    console.warn(`[rpc-health-degradation-alert] tick fail (non-fatal, retry next cycle): ${e.message}`);
    return { ok: false, reason: e.message };
  } finally {
    running = false;
  }
}

export function startRpcHealthDegradationAlertCron() {
  if (timer) return;
  console.log(`[rpc-health-degradation-alert] started — tick=${TICK_INTERVAL_MS}ms, window=${WINDOW_MINUTES}min, threshold=${FAIL_THRESHOLD}, selfRestart=${SELF_RESTART_ENABLED ? `ON(confirm=${SELF_RESTART_CONFIRM_MS / 60000}min, supervisor-gated)` : 'OFF'} (写events+播${ALERT_CHANNEL}频道)`);
  setTimeout(() => { rpcHealthAlertTick().catch((e) => console.error('[rpc-health-degradation-alert] startup tick:', e.message)); }, STARTUP_GRACE_MS);
  timer = setInterval(() => { rpcHealthAlertTick().catch((e) => console.error('[rpc-health-degradation-alert] tick:', e.message)); }, TICK_INTERVAL_MS);
}

export function stopRpcHealthDegradationAlertCron() {
  if (timer) { clearInterval(timer); timer = null; }
  // 对称清全部状态(同 _resetAlertStateForTest)——只清 _lastSeenMaxFailRowid 不清 _dbWatermarkChecked
  // 在当前唯一调用点(进程真退出)上无差别, 但若未来出现同进程内 stop()→start()(例如维护窗口暂停
  // 监控)会复活这次修的同一个 bug 的缩小版(NWT diff 复核 #145baeb8 抓到, 当时 grep 确认零调用点
  // 不阻塞, 现在顺手补上不留债)。
  _lastSeenMaxFailRowid = null;
  _lastAlertPostedAt = null;
  _dbWatermarkChecked = false;
  _episodeStartedAt = null;
  _selfRestartAttemptedForEpisode = false;
}

// 测试专用: 重置 module-level 水位线状态。清 _dbWatermarkChecked 是关键——它模拟"进程重启"
// (下次 tick 会重新去 DB 查一次历史水位线), 不是模拟"已恢复"(那种情况只清 _lastSeenMaxFailRowid +
// _lastAlertPostedAt + _episodeStartedAt, 见 rpcHealthAlertTick 的 count===0 分支, 不清
// _dbWatermarkChecked)。
export function _resetAlertStateForTest() {
  _lastSeenMaxFailRowid = null;
  _lastAlertPostedAt = null;
  _dbWatermarkChecked = false;
  _episodeStartedAt = null;
  _selfRestartAttemptedForEpisode = false;
}
