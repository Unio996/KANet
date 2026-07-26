// ux1-capability-manifest.mjs — UX1 能力清单【单一来源】v0.1 (J2, 契约 DRI)
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

/** M0b manifest 的预期位置。M0b 落地后, 本文件改为从它生成, 而不是维护这份手写表。 */
export const M0B_MANIFEST_PATH = 'kasia-console/src/contract/m0b-manifest.json'; // 🔴 当前不存在

/** 能力状态三态。不设第四个"其他" —— 无名兜底会静默吸收不合身的东西 (NWT 04:39 ④ 同理)。 */
export const STATUS = Object.freeze({
  MOCK_ONLY: 'MOCK_ONLY',         // 有 mock 实现, 而没有真实能力
  NOT_AVAILABLE: 'NOT_AVAILABLE', // 未实现 —— §6A.2 DoD 指定的 token, 不许换词
  READ_ONLY: 'READ_ONLY',         // 真实能力, 而只读
});

/**
 * 唯一来源。每一项必须写 why —— 因为外部评审者问的是"为什么不能用", 不是"能不能用"。
 * 🔴 status 一律按【现在】填, 不按【计划】填。§6A.2 DoD: 不得用愿景假装已经可用。
 */
export const CAPABILITIES = Object.freeze([
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
    why: '§16.3 :1490 明令 UX1/M0b v1 不得提前加入, 后移 M5/契约 v2。⇒ 这一项【不是"还没做"、是"本版故意不做"】。',
  },
]);

/**
 * 🔴 接缝: 每次渲染都跑。M0b manifest 不存在时【大声说】, 而不是沉默。
 * 判据 (Bettor 04:41): 跑这套 mock 的任何人, 都必须在输出里看见这句话。
 * @returns {{sameSource: boolean, notice: string}}
 */
export function assertManifestProvenance(manifestExists = false) {
  if (manifestExists) {
    return { sameSource: true, notice: '' };
  }
  return {
    sameSource: false,
    notice:
      '🔴 能力清单不是同源生成的 —— M0b manifest 尚未落地 (' +
      M0B_MANIFEST_PATH +
      ' 不存在), 本清单为手写占位。§6A.2 DoD「mock 与 M0b manifest 同源生成」当前【未满足】。',
  };
}

/** 渲染一: 机器可判 token, 进响应体。黑盒脚本 / CI 可对它断言。 */
export function toResponseTokens(manifestExists = false) {
  const prov = assertManifestProvenance(manifestExists);
  return {
    capabilities: CAPABILITIES.map((c) => ({ id: c.id, status: c.status })),
    manifest_same_source: prov.sameSource,
    manifest_notice: prov.notice || undefined, // 🔴 不同源时它必然出现在响应里
  };
}

/** 渲染二: 人可见, 未实现能力显式标红 (§16.3 :1489)。与渲染一同源。 */
export function toMarkedDoc(manifestExists = false) {
  const prov = assertManifestProvenance(manifestExists);
  const lines = [];
  if (!prov.sameSource) lines.push(prov.notice, '');
  lines.push('| 能力 | 状态 | 为什么 |', '|---|---|---|');
  for (const c of CAPABILITIES) {
    const mark = c.status === STATUS.NOT_AVAILABLE ? '🔴 ' : c.status === STATUS.MOCK_ONLY ? '🟡 ' : '✅ ';
    lines.push(`| ${c.title} | ${mark}\`${c.status}\` | ${c.why} |`);
  }
  return lines.join('\n');
}

// ⚠️ 覆盖边界 (本文件自述, 不藏):
//   🔴 未做: 与真实系统对账 —— 上表每一项的 status 依据是本轮频道内的实测报告与卡文,
//            我【没有】逐项去跑一遍确认它此刻确实不可用。⇒ 这是【转述+读卡】, 不是【实跑】。
//   🔴 未做: proof_query 那项标 READ_ONLY, 而"用户实际拿到的是纯文本 txid"来自 NWT 04:05 实读,
//            我未独立复核。
//   🔴 未做: 本文件尚未被任何 CI 跑过 —— DoD「示例由 CI 实际运行」未满足。
//   ⚠️ 待定: 文档与脚本谁是源 (NWT ① 那格), 我已问未答 ⇒ 本文件不预设方向, 只做数据源。
