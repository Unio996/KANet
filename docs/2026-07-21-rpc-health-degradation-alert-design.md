# RPC 健康劣化检测告警(KANet-UI,2026-07-21,半页设计)

## 背景
今天 RpcClient 状态劣化复发两次(07:35Z / 14:48Z,间隔仅约7小时,第二次冻结 settle-daemon tick 44 分钟才被人肉巡检发现)。Bettor 派工(#utf9ze.1):先落地检测告警(owner=KANet-UI),自动重启暂不做(告警先行,防误杀)。根因排查另立卡(owner=J2,非紧急)。

## 设计(复用今晚 `bshard-coherence-observability-monitor.mjs` 的 cron+events 表模式,不另造轮子)

**信号源**:`rpc-health.js` `getWorkingRpc()` 唯一失败出口(184行 `console.warn('[rpc-health] no RPC node available')`)。
1. 该分支加一行 `INSERT INTO events (event_type='rpc_health_check_failed', level='warn', ...)`,每次真实失败都留痕(轻量,不做计数/判断,单纯记录原始信号——同 `ps_coherence_gate_fail` 写入点的角色)。
2. 新建 `rpc-health-observability-monitor.mjs`(架构完全镜像 `bshard-coherence-observability-monitor.mjs`):5 分钟 tick,统计过去 N 分钟(建议 10 分钟)内 `rpc_health_check_failed` 事件数,达到阈值(建议连续覆盖窗口内 ≥5 条,大约对应持续 2-3 分钟以上的真实劣化,而非单次瞬时抖动)→ 升级写 `rpc_health_degraded_alert` 事件(level='error')+去重(55 分钟内只报一次,同既有模式)。

## 与"牙建好没人看"的区别(今晚教训,不留同款坑)
只写 `events` 表不够——之前 `ps_redeem_recompile_mismatch` 这条先例证明没人主动查表等于没人看见。本卡触发升级事件时,**同时直接 POST 一条消息到 `dev-coord-testnet` 频道**(复用现成 `/api/chat/send`,走 KANet-UI 自己的 relay,同今晚全部人工播报走的同一条通路),消息内容含:触发时间窗口/失败次数/建议动作(检查 kaspad 进程健康+走已验证过的 runbook:重启 console)。这样告警不是"写表等人查",是主动喊话,同今晚全部人工 LOUD 上报同一个可见性标准。

## 不做的事(明确边界)
- 不自动重启 console(Bettor 明确:自动化动作等告警跑稳再议,防误杀——例如短暂的网络抖动不该触发重启)。
- 不改 `rpc-health.js` 现有的失败处理/重试/缓存逻辑本身,只加一行事件写入,零行为改变。

## DoD
- 离线回归测试:模拟连续 N 次失败触发一次告警(且去重生效,连续触发不重复发频道)+ 低于阈值不触发两类场景。
- 装载后活代码验证:人为制造一次短暂 RPC 不可达(或等下次自然复发)观察告警确实到频道。
