// oracle-shadow-ledger.mjs — 影子判定台账 (Owner 钦定"自我进化" 2026-06-30·槽位 #26·J1)
//
// 🎯 目的: 每个盘结算时记一行 = {权威判定(谁结的钱), 我们自己 oracle 的独立判定, 是否一致, 领域}。
//   攒"我们 vs 权威"命中率历史 → 哪个领域我们判得准(可升授权独立判) / 哪个领域还没独立源(=路线图)。
//   = "UMA 当答案册·一个领域一个领域出师"(Owner)。
//
// 🔴🔴 BETTOR 守门铁律 1 (money-path): **shadow 永不碰结算**。
//   recordShadowJudgment 是【结算决定之后】的纯记录副作用·**全程 try/catch·绝不 throw**——
//   台账出任何错都不能影响 settle(settle 照常只走权威 judgeWinDir 返回值)。调用方必须 await 在 settle 成功之后·
//   且即便不 await / 抛错也不得阻断结算(本模块内部已吞所有错·返回 {recorded:false} 而非 throw)。
//
// 分层(对应 Owner 总思路):
//   【权威层=结真钱】authority_* = judgeWinDir 实际用于结算的判定(polymarket→UMA CTF / ESPN→judgeLine)。已被证明=结钱。
//   【学习层=影子】our_oracle_* = 我们自己的独立判定·跑在旁边不碰钱·和权威对比攒命中率。NULL=该领域尚无独立数据源。
//
// 领域判 registry (pluggable·NWT 排域序滚动建): 每个领域判 = { id, appliesTo(market)→bool, async judge(market)→'YES'|'NO'|'ABSTAIN' }。
//   judge 必须用【独立数据源】(体育=judgeLine 读 ESPN / 加密=链上价格 / politics=新闻共识)·**禁用市场价**(= #50 循环·禁)。
//   今天 registry 空 = 所有盘 our_oracle=NULL(=路线图: 标好领域留路·NWT 一个领域一个领域填)。

const _domainJudges = [];

// 🟡 J2 forward-looking 守门(域判上线前硬化): 领域判可能做慢/挂的网络调用(抓 crypto 价等)。
//   per-judge timeout = shadow 不拖慢结算(把 Bettor 铁律1 从"不碰决策"延伸到"不拖时延")。挂→ABSTAIN(记下不阻断)。
const JUDGE_TIMEOUT_MS = Number(process.env.SHADOW_JUDGE_TIMEOUT_MS) || 8000;
const _withTimeout = (p, ms) => Promise.race([
  Promise.resolve(p),
  new Promise((_, rej) => setTimeout(() => rej(new Error(`judge timeout ${ms}ms`)), ms)),
]);

/** 注册一个领域判 (NWT 域序滚动调用)。judge.judge(market) 必须用独立源·非市场价(#50)。 */
export function registerDomainJudge(judge) {
  if (!judge || typeof judge.judge !== 'function' || typeof judge.appliesTo !== 'function' || !judge.id) {
    throw new Error('registerDomainJudge: need { id, appliesTo(market)→bool, async judge(market)→YES|NO|ABSTAIN }');
  }
  _domainJudges.push(judge);
  return _domainJudges.length;
}

export function listDomainJudges() { return _domainJudges.map((j) => j.id); }

const _windirToVerdict = (wd) => (wd === 0 ? 'YES' : wd === 1 ? 'NO' : null);
const _verdictToWindir = (v) => (v === 'YES' ? 0 : v === 'NO' ? 1 : null);

/**
 * 跑我们自己的独立判定(影子)。返回 { source, verdict, windir } 或 { source:null, verdict:null }(无领域判)。
 * 全程 defensive: 领域判抛错 → 视为 ABSTAIN(记下不阻断)·绝不冒泡。
 */
async function computeOurOracleVerdict(market) {
  for (const dj of _domainJudges) {
    let applies = false;
    try { applies = !!dj.appliesTo(market); } catch { applies = false; }
    if (!applies) continue;
    try {
      const v = await _withTimeout(dj.judge(market), JUDGE_TIMEOUT_MS);   // 慢/挂 judge → reject → ABSTAIN(不拖结算)
      const verdict = v === 'YES' || v === 'NO' ? v : 'ABSTAIN';
      return { source: dj.id, verdict, windir: _verdictToWindir(verdict) };
    } catch (e) {
      return { source: dj.id, verdict: 'ABSTAIN', windir: null, error: String(e?.message || e).slice(0, 160) };
    }
  }
  return { source: null, verdict: null, windir: null };   // 无独立源 = 路线图空白
}

/**
 * 记一行影子台账。**结算成功后调用·永不 throw·永不碰结算状态**。
 * @param db          better-sqlite3 实例
 * @param market      pool_markets 行 (需 id/category/outcome_market_source/settle_txid?/deadline?)
 * @param authorityWinDir  judgeWinDir 返回值 (0=YES/1=NO)·= 实际结钱的权威判定
 * @param authoritySource  'uma_ctf' | 'espn_judgeline' (按 market.outcome_market_source 推)
 * @param settleTxid  结算 TX (可选·审计锚)
 * @returns {recorded:boolean, agree:0|1|null, reason?:string}
 */
export async function recordShadowJudgment(db, opts) {
  try {
    // 守门铁律1: 在 try 内解构(非签名)·显式 null opts 也不得在进 try 前抛 → 永不冒泡影响结算。
    const { market, authorityWinDir, authoritySource, settleTxid } = opts || {};
    if (!db || !market || (authorityWinDir !== 0 && authorityWinDir !== 1)) {
      return { recorded: false, agree: null, reason: 'bad args (shadow skipped·不影响结算)' };
    }
    const authorityVerdict = _windirToVerdict(authorityWinDir);
    const src = authoritySource || (market.outcome_market_source === 'polymarket' ? 'uma_ctf' : 'espn_judgeline');

    const our = await computeOurOracleVerdict(market);   // 内部已 defensive
    // agree: 双方都有 definitive(YES/NO)才比·一致=1/分歧=0; 我方 NULL 或 ABSTAIN → NULL(无可对比)。
    let agree = null, divergence = null;
    if (our.verdict === 'YES' || our.verdict === 'NO') {
      agree = our.verdict === authorityVerdict ? 1 : 0;
      if (agree === 0) divergence = `our(${our.source})=${our.verdict} vs authority(${src})=${authorityVerdict}`;
    } else if (our.source && our.verdict === 'ABSTAIN') {
      divergence = our.error ? `our(${our.source}) ABSTAIN: ${our.error}` : `our(${our.source}) ABSTAIN`;
    }

    db.prepare(`
      INSERT OR IGNORE INTO oracle_shadow_ledger
        (market_id, domain, market_source, authority_source, authority_verdict, authority_windir,
         our_oracle_source, our_oracle_verdict, our_oracle_windir, agree, divergence_reason, settle_txid, deadline)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      market.id, market.category || null, market.outcome_market_source || null,
      src, authorityVerdict, authorityWinDir,
      our.source, our.verdict, our.windir, agree, divergence,
      settleTxid || market.settle_txid || null, market.deadline ?? null,
    );
    return { recorded: true, agree, reason: divergence || null };
  } catch (e) {
    // 守门铁律1: 台账任何错都不得冒泡影响结算。
    return { recorded: false, agree: null, reason: `shadow-ledger error (吞·不影响结算): ${String(e?.message || e).slice(0, 160)}` };
  }
}

/**
 * 命中率报表: 按领域汇总 (Owner 那张"我们 vs 权威 各领域命中率"表)。
 * @returns { byDomain: [{domain, market_source, total, covered, agree, disagree, abstain, agreement_rate}], overall }
 */
export function shadowAccuracyReport(db) {
  const rows = db.prepare(`
    SELECT domain, market_source,
           COUNT(*)                                            AS total,
           SUM(CASE WHEN our_oracle_verdict IN ('YES','NO') THEN 1 ELSE 0 END) AS covered,
           SUM(CASE WHEN agree = 1 THEN 1 ELSE 0 END)          AS agree,
           SUM(CASE WHEN agree = 0 THEN 1 ELSE 0 END)          AS disagree,
           SUM(CASE WHEN our_oracle_verdict = 'ABSTAIN' THEN 1 ELSE 0 END)     AS abstain
    FROM oracle_shadow_ledger
    GROUP BY domain, market_source
    ORDER BY total DESC
  `).all();
  const byDomain = rows.map((r) => ({
    ...r,
    // 命中率 = 一致 / (我方有 definitive 判定的盘数)·covered=0 → null(该领域还没独立源·=路线图空白)
    agreement_rate: r.covered > 0 ? +(r.agree / r.covered).toFixed(4) : null,
  }));
  const tot = byDomain.reduce((a, r) => a + r.total, 0);
  const cov = byDomain.reduce((a, r) => a + r.covered, 0);
  const agr = byDomain.reduce((a, r) => a + r.agree, 0);
  return {
    byDomain,
    overall: { total: tot, covered: cov, agree: agr, agreement_rate: cov > 0 ? +(agr / cov).toFixed(4) : null },
  };
}
