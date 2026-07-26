// ux1-capability-manifest.mjs — UX1 能力清单【单一来源】v0.3 (J2, 契约 DRI)
//
// 卡: c45acd37 v1.2 §6A.2 UX1-LIVING-QUICKSTART · 契约 DRI = J2
//
// 🔴 为什么是"单一来源"而不是两份清单 (§6A.2 DoD + §16.3 :1489 两条都要):
//   §6A.2 :510  「未实现能力明确标 `NOT_AVAILABLE`, 不得用愿景假装已经可用」← 机器可判 token
//   §16.3 :1489 「UX1 只能使用 mock/read-only 能力, 未实现能力必须显式标红」← 人可见标记
//   ⇒ 两条【都要】。而若各写一份, 它们会各自漂移 ⇒ 又一个双权威源 (NWT 04:38)
//   ⇒ 所以: 一份数据 (CAPABILITIES), 两种渲染 (toResponseTokens / toMarkedDoc)
//
// 🔴 §6A.2 DoD 另有一条:「mock 与 M0b manifest 同源生成」
//   而 M0b (§9.3) 尚未开始 ⇒ 这一条【当前不可能满足】, 本文件不声称满足它。
//   处置 (Bettor 04:41 批 · NWT 04:39 加严): 留显式接缝, 且【接缝必须自己会喊】——
//   判据逐字: "M0b 落地之前, 任何人跑这套 mock, 都必须在输出里看见『能力清单不是同源生成的』"
//   ⇒ 见 assertManifestProvenance(), 它在每次渲染时都跑, 不是一句注释。

import { existsSync } from 'node:fs';
import { resolve, dirname, parse as parsePath } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 🔴🔴 v0.3 (NWT 04:52 红队⑤): 仓库根【由本模块自己定位】, 不由调用方给。
 *   v0.1 是布尔参数, v0.2 换成路径参数 —— 病没消灭, 只换了一层:
 *   两版的强度都取决于【调用方给什么】。而 manifest 在仓库里的位置是【仓库布局的事实】,
 *   不是【谁在调用】的事实。
 * 🔴 而"上溯 N 层"我不用 —— 今晚已查出"数斜杠算 ROOT"是缺陷温床(文件挪位置就静默出错)。
 *   改为向上找 `.git`, 与本仓 repo-root.mjs 同一根治写法。
 */
function locateRepoRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  const rootOf = parsePath(dir).root;
  for (;;) {
    if (existsSync(resolve(dir, '.git'))) return dir;
    if (dir === rootOf) throw new Error('locateRepoRoot: 从本模块向上未找到 .git —— 无法定位仓库根');
    dir = dirname(dir);
  }
}

/** M0b manifest 的预期位置。M0b 落地后, 本文件改为从它生成, 而不是维护这份手写表。 */
export const M0B_MANIFEST_PATH = 'kasia-console/src/contract/m0b-manifest.json'; // 🔴 当前不存在

/** 能力状态三态。不设第四个"其他" —— 无名兜底会静默吸收不合身的东西 (NWT 04:39 ④ 同理)。 */
export const STATUS = Object.freeze({
  MOCK_ONLY: 'MOCK_ONLY',         // 有 mock 实现, 而没有真实能力
  NOT_AVAILABLE: 'NOT_AVAILABLE', // 未实现 —— §6A.2 DoD 指定的 token, 不许换词
  READ_ONLY: 'READ_ONLY',         // 真实能力, 而只读
});

/**
 * 🔴🔴 v0.2 新增 (NWT 04:46 红队④): 与 status 【正交】的一维。
 *   v0.1 里"本版故意不做(有裁定)"与"根本没建"共用同一个 `NOT_AVAILABLE` token,
 *   ⇒ 黑盒脚本与外部程序看到的是同一个值, 那个重要区别被 token 抹平了。
 *   ⇒ status 保持卡指定的 token 不动(§6A.2 :510), 区别放这一维。两条都满足, 不冲突。
 */
export const REASON = Object.freeze({
  NOT_BUILT: 'not_built',
  OUT_OF_SCOPE_BY_RULING: 'out_of_scope_by_ruling',
});

/**
 * 规范化 + 校验 + 深冻结。
 * 🔴 v0.3 改名 (NWT 04:52 红队⑥-i): v0.2 叫 deepFreeze 而它还【改数据】—— 名不副实。
 * 🔴 v0.3 加 enforce (红队⑥-ii): v0.2 那条"写 OUT_OF_SCOPE_BY_RULING 必须给条号"
 *    【只是一句注释】, 没有任何东西 enforce 它。而我整夜在把"靠自觉"换成"让它不可能"。
 *    ⇒ 现在它在 freeze 之前校验, 缺条号直接抛 —— 让"故意不做"当不成万能借口。
 */
function normalizeValidateFreeze(arr) {
  for (const o of arr) {
    if (o.reason_class === undefined) o.reason_class = REASON.NOT_BUILT;
    if (o.reason_class === REASON.OUT_OF_SCOPE_BY_RULING && !/§\s*[\d.]+/.test(o.why || '')) {
      throw new Error(
        `能力 "${o.id}" 标了 OUT_OF_SCOPE_BY_RULING, 而 why 里没有裁定条号(形如 §16.3)。` +
          '⇒ 没有条号的"本版故意不做"不许存在 —— 那是万能借口, 不是裁定。',
      );
    }
    Object.freeze(o);
  }
  return Object.freeze(arr);
}

/**
 * 唯一来源。每一项必须写 why —— 因为外部评审者问的是"为什么不能用", 不是"能不能用"。
 * 🔴 status 一律按【现在】填, 不按【计划】填。§6A.2 DoD: 不得用愿景假装已经可用。
 */
export const CAPABILITIES = normalizeValidateFreeze([
  {
    id: 'caller_identity',
    title: 'caller identity 与 capability 获取',
    status: STATUS.NOT_AVAILABLE,
    why: 'M0c 能力强制尚未启用 (§5.2: M0c 不得在 M0b 之前启用)。当前外部程序无法获得 scoped 凭证。',
  },
  {
    id: 'status_query',
    title: 'read-only status 查询',
    status: STATUS.NOT_AVAILABLE,
    why: 'B0-O5 只读能力状态端点未落地; /api/capability/status 实测 404 (Bettor 20:34)。',
  },
  {
    id: 'proof_query',
    title: 'read-only proof 查询 (链上凭据)',
    status: STATUS.READ_ONLY,
    why: '每笔结算带 txid, 可自行验。⚠️ TN12 无公网 explorer (explorer-tn12.kaspa.org 域名不存在, Bettor 04:02 实跑), 需自建/接入 TN12 节点。',
  },
  {
    id: 'lifecycle_mock',
    title: 'Intent → Agreement → Value Event → Settlement → Claim/Exit',
    status: STATUS.MOCK_ONLY,
    why: '本包提供 mock 走通全程。真实链路中 Settlement 有两条路径未接落链校验 (B0-M1 钱路阻塞), 不对外开放。',
  },
  {
    id: 'external_onboarding',
    title: '外部程序自助接入 (HTTP)',
    status: STATUS.NOT_AVAILABLE,
    why: '当前接入必须先自建 Telegram bot 并交出 token。HTTP 能力网关是 M0c-1 的目标, 未落地。',
  },
  {
    id: 'agent_card_discovery',
    title: 'Agent Card / Discovery / Trust Facts',
    status: STATUS.NOT_AVAILABLE,
    reason_class: REASON.OUT_OF_SCOPE_BY_RULING, // 🔴 v0.2 红队④: 与"尚未建"那五项区分开
    why: '§16.3 :1490 明令 UX1/M0b v1 不得提前加入, 后移 M5/契约 v2。⇒ 这一项【不是"还没做"、是"本版故意不做"】, 裁定条号即 §16.3 :1490。',
  },
]);

/**
 * 🔴 接缝: 每次渲染都跑, 而它【自己去看盘上有没有那个文件】。
 *
 * 🔴🔴 v0.2 修 (NWT 04:46 红队①): v0.1 这个函数收一个 `manifestExists` 参数、默认 false,
 *   全文零 fs —— 也就是说它【从不检测任何东西】, 强度完全取决于调用方传什么。
 *   任何人调 toResponseTokens(true) 就能让它闭嘴。
 *   ⇒ 而本仓已有的那条(我自己今晚立的)逐字: 「闸的强度不在闸里在调用点;
 *      读闸自己的代码永远证不出它在闸住东西」—— 我建了一个正是那个形状的东西, 且把它叫作 assert。
 *   ⇒ 修法取 (a): 函数自己 stat 那个路径。它因此不再是纯函数 —— 而【检测】本来就不该是纯的。
 *
 * 判据 (Bettor 04:41): M0b 落地之前, 任何人跑这套 mock, 都必须在输出里看见那句话。
 * @returns {{sameSource: boolean, notice: string}}
 */
export function assertManifestProvenance() {
  let exists = false;
  let probeError = null;
  try {
    // 🔴 检测【失败】必须 fail 成"喊", 不是 fail 成"静默通过" (NWT 04:43 压的那格)
    exists = existsSync(resolve(locateRepoRoot(), M0B_MANIFEST_PATH));
  } catch (e) {
    probeError = e && e.message ? e.message : String(e);
  }

  if (probeError !== null) {
    return {
      sameSource: false, // 🔴 探测本身坏了 ⇒ 一律按【不同源】处理, 绝不默认放行
      notice:
        '🔴 无法判定能力清单是否同源生成 —— 探测 M0b manifest 时出错: ' +
        probeError +
        ' ⇒ 按未同源处理。§6A.2 DoD「mock 与 M0b manifest 同源生成」【未满足】。',
    };
  }
  if (exists) return { sameSource: true, notice: '' };
  return {
    sameSource: false,
    notice:
      '🔴 能力清单不是同源生成的 —— M0b manifest 尚未落地 (' +
      M0B_MANIFEST_PATH +
      ' 不存在), 本清单为手写占位。§6A.2 DoD「mock 与 M0b manifest 同源生成」当前【未满足】。',
  };
}

/**
 * 🔴🔴 v0.2 新增 (NWT 04:46 红队③): 这一句必须跟着【渲染出来的东西】走。
 *   v0.1 把它写在文件末尾的覆盖边界栏里 —— 而外面那个人【永远不会打开这个 .mjs】,
 *   他读到的是一张状态表, 读不到"这些状态从未对运行中的系统核过"。
 *   ⇒ 限定必须在结论位自带, 不靠另一处交叉引用。
 */
export const PROVENANCE_OF_STATUSES =
  '⚠️ 上表每一格的状态来自【读卡与频道内的实测报告】, 未逐项对运行中的系统实跑核对 ⇒ 强度: 转述+读卡, 非实跑。';

/** 状态 → 人可见标记。🔴 穷尽映射, 不设 else —— 未知状态必须刺眼, 绝不默认绿。 */
const STATUS_MARK = Object.freeze({
  [STATUS.NOT_AVAILABLE]: '🔴 ',
  [STATUS.MOCK_ONLY]: '🟡 ',
  [STATUS.READ_ONLY]: '✅ ',
});
function markOf(status) {
  // 🔴🔴 v0.2 修 (NWT 04:46 红队②): v0.1 用三元 ?: 只显式判两态, 第三态走 else
  //   ⇒ 将来任何新增状态会静默落进 else 渲染成 ✅ 绿 —— 而绿是最不该被默认选中的那一档。
  //   ⇒ 讽刺在于: 我在同一个文件里写着"不设第四个『其他』", 然后在渲染器里建了一个兜底。
  const m = STATUS_MARK[status];
  if (m === undefined) return `🔴 UNKNOWN_STATUS(${String(status)}) `;
  return m;
}

/** 渲染一: 机器可判 token, 进响应体。黑盒脚本可对它断言。 */
export function toResponseTokens() {
  const prov = assertManifestProvenance();
  return {
    capabilities: CAPABILITIES.map((c) => ({
      id: c.id,
      status: c.status,
      reason_class: c.reason_class, // 🔴 v0.2 红队④: 与 status 正交, 别让"故意不做"被 token 抹平
    })),
    manifest_same_source: prov.sameSource,
    manifest_notice: prov.notice || undefined, // 🔴 不同源时它必然出现在响应里
    status_provenance: PROVENANCE_OF_STATUSES, // 🔴 v0.2 红队③: 跟着响应走
  };
}

/** 渲染二: 人可见, 未实现能力显式标红 (§16.3 :1489)。与渲染一同源。 */
export function toMarkedDoc() {
  const prov = assertManifestProvenance();
  const lines = [];
  if (!prov.sameSource) lines.push(prov.notice, '');
  lines.push(PROVENANCE_OF_STATUSES, ''); // 🔴 v0.2 红队③: 在表【之前】, 读表的人绕不过
  lines.push('| 能力 | 状态 | 不可用的性质 | 为什么 |', '|---|---|---|---|');
  for (const c of CAPABILITIES) {
    const cls = c.reason_class === REASON.OUT_OF_SCOPE_BY_RULING ? '本版故意不做(有裁定)' : '尚未建';
    lines.push(`| ${c.title} | ${markOf(c.status)}\`${c.status}\` | ${cls} | ${c.why} |`);
  }
  return lines.join('\n');
}

// ⚠️ 覆盖边界 (本文件自述, 不藏):
//   🔴 未做: 与真实系统对账 —— 上表每一项的 status 依据是本轮频道内的实测报告与卡文,
//            我【没有】逐项去跑一遍确认它此刻确实不可用。⇒ 这是【转述+读卡】, 不是【实跑】。
//   🔴 未做: proof_query 那项标 READ_ONLY, 而"用户实际拿到的是纯文本 txid"来自 NWT 04:05 实读,
//            我未独立复核。
//   🔴 未做: 本文件尚未被任何 CI 跑过 —— DoD「示例由 CI 实际运行」未满足。
//   ✅ 已闭合(Bettor 04:42 裁): 文档是源, runner 抽取并执行文档里的代码块。本文件是数据源, 不参与那个方向。
