// p2sh-ktt-panel-gate.test.mjs — D-035 NWT diff 审 MUST 闭合 §④(2026-09-27, docs/iteration/j1-inbox/
// 2026-09-27T13-55Z-nwt-VERDICT-d035-ktt-v2-impl-diff-review.md §⑥): relay 侧纵深防御单测。
// 只测 _assertKttPanelRelayAuthorized 本身(纯同步 env 读取+抛错, 不碰网络/RPC/私钥), 不测
// unlockKttV2Mint/unlockKttV2Transfer 全流程(那部分已由 docs/provenance/2026-09-27-j2-ktt-v2-simnet/
// 的真实 simnet 广播证据覆盖, 这里只补新加的这一道闸)。
// Run: cd kasia-relay && node src/lib/p2sh-ktt-panel-gate.test.mjs

const { _assertKttPanelRelayAuthorized } = await import('./p2sh.mjs');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const throws = (f, re, msg) => {
  try { f(); throw new Error(`${msg}: 期望抛错, 未抛`); } catch (e) {
    if (e.message.startsWith(`${msg}: 期望抛错`)) throw e;
    if (re && !re.test(e.message)) throw new Error(`${msg}: 错误信息不匹配(实际: ${e.message})`);
  }
};

const ORIG = { ENABLED: process.env.KTT_PANEL_ENABLED, RELAY_ID: process.env.KTT_PANEL_RELAY_ID, SELF: process.env.RELAY_NODE_ID };
function reset() {
  delete process.env.KTT_PANEL_ENABLED;
  delete process.env.KTT_PANEL_RELAY_ID;
  delete process.env.RELAY_NODE_ID;
}

t('① KTT_PANEL_ENABLED 未设 ⇒ 拒绝(纵深防御独立于 console 侧开关)', () => {
  reset();
  throws(() => _assertKttPanelRelayAuthorized('unlockKttV2Mint'), /KTT panel disabled/, '开关未设应拒');
});

t('② KTT_PANEL_ENABLED=0 ⇒ 拒绝', () => {
  reset(); process.env.KTT_PANEL_ENABLED = '0';
  throws(() => _assertKttPanelRelayAuthorized('unlockKttV2Mint'), /KTT panel disabled/, '开关=0应拒');
});

t('③ KTT_PANEL_ENABLED=1 但 KTT_PANEL_RELAY_ID 未配 ⇒ 拒绝(不默认放行)', () => {
  reset(); process.env.KTT_PANEL_ENABLED = '1';
  throws(() => _assertKttPanelRelayAuthorized('unlockKttV2Mint'), /KTT_PANEL_RELAY_ID 未配置/, '专用 relay 未配应拒');
});

t('④ KTT_PANEL_ENABLED=1 + KTT_PANEL_RELAY_ID 已配 但本 relay RELAY_NODE_ID 未设 ⇒ 拒绝', () => {
  reset(); process.env.KTT_PANEL_ENABLED = '1'; process.env.KTT_PANEL_RELAY_ID = 'relay-ktt-dedicated';
  throws(() => _assertKttPanelRelayAuthorized('unlockKttV2Transfer'), /不是 KTT panel 专用 relay/, '本 relay 身份未设应拒');
});

t('⑤ relay_id 不符(本 relay 是别的身份) ⇒ 拒绝(核心场景: 防止任意 relay 被指为专用 relay 之外的另一台错误响应)', () => {
  reset(); process.env.KTT_PANEL_ENABLED = '1'; process.env.KTT_PANEL_RELAY_ID = 'relay-ktt-dedicated'; process.env.RELAY_NODE_ID = 'relay-some-other-one';
  throws(() => _assertKttPanelRelayAuthorized('unlockKttV2Mint'), /不是 KTT panel 专用 relay/, 'relay 不符应拒');
});

t('⑥ 全部条件满足(开关开 + 专用 relay 已配 + 本 relay 就是那一个) ⇒ 放行(不抛)', () => {
  reset(); process.env.KTT_PANEL_ENABLED = '1'; process.env.KTT_PANEL_RELAY_ID = 'relay-ktt-dedicated'; process.env.RELAY_NODE_ID = 'relay-ktt-dedicated';
  _assertKttPanelRelayAuthorized('unlockKttV2Mint'); // 不抛即通过
});

reset();
if (ORIG.ENABLED !== undefined) process.env.KTT_PANEL_ENABLED = ORIG.ENABLED;
if (ORIG.RELAY_ID !== undefined) process.env.KTT_PANEL_RELAY_ID = ORIG.RELAY_ID;
if (ORIG.SELF !== undefined) process.env.RELAY_NODE_ID = ORIG.SELF;

console.log(`\n[summary] ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
