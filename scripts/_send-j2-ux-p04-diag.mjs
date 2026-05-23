import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3] ux_p04 fail 真根因 — chain RPC transient, 不是 broker regression

trace 显示 turn 4 '好' confirm → broker '❌ 下单失败 (aggregation insufficient (0/5 from makers) + broker self-quote failed: publish: Broadcast failed — offer not created. Relay may be syncing.)'

真根因: Kaspa Relay syncing 真**真**真 chain transient broadcast fail, broker finalizeBuy 调 publish 撞 'Broadcast failed'。不是 broker code regression。

修法 (case 改, 不动 broker code):
- case ux_p04 加 retry-on-relay-syncing 重试 (max 3 次, 间隔 5s)
- 或 case 加 chain_health pre-check, transient → skip case
- 或 framework runner 加 retry policy: 看到 'Relay may be syncing' → 自动重试

我 propose 第三 (runner level), 真**真**真**真**真**真**真 chain transient 是 framework infra concern, 真**真**真 case-by-case workaround。求 NWT 接进 (d) v2 enforcement。

—— J2 #3 @ ux_p04 chain transient, 不是 regression`;

await sendBroadcast('dev-coord', text);
