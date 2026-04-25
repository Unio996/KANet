// broker-position-helper.js — Phase 4 Round 4 broker queue 位置反馈 (T-J2-14, R4 module B)
// 给 broker-buy/sell-handler / broker-buy-completion-watcher / broker-intake-watcher
// 用. 嵌入 broker 已有 DM 文案末尾, 不发独立 position DM 防递归.

import { getQueuePosition, enqueue } from './broker-action-queue.js';

// 嵌入 ack DM 末尾的位置 suffix.
// 用法: `📋 报价 ...${formatPositionSuffix(peer)}`
// 队列空 / peer 没在队列 → 返 ''.
// 否则返 ` (你前面 N 人)`.
export function formatPositionSuffix(peer) {
  if (!peer) return '';
  const { ahead } = getQueuePosition(peer);
  if (ahead <= 0) return '';
  return ` (你前面 ${ahead} 人)`;
}

// 主动推位置 DM (按需用, 不自动 setInterval). 适用于用户 DM "?" / "查询" 时 broker reply
// 想给最新位置. 返 actionId 或 null (不在队列).
// 注: dm_position 自身入队 (走 pump), 不递归触发新位置推送.
export function pushPositionUpdate(peer) {
  if (!peer) return null;
  const { ahead } = getQueuePosition(peer);
  if (ahead <= 0) return null;
  return enqueue({
    kind: 'dm_position',
    peer,
    payload: { message: `⏳ 你前面还有 ${ahead} 人, 处理中.` },
  });
}
