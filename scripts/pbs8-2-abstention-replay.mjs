/**
 * PB-S8-2 §2.1#2 —— 新拒签条件的【弃权率实测】(离线重放, 只读)
 *
 * 为什么要这份: D4 那条闸担心的是"新 enforce 会不会把弃权率抬上去"。设计 §2.1#2 要求的
 * 不是估计, 是**拿本机 159 个带 phase2_tx_obj 的历史市场离线重放这些判定, 报出会被拒的条数**,
 * 且 **>0 必须逐条解释**(是真的坏, 还是判定过严)。Bettor 10:42 D4 裁定把这份列为
 * 上报 Owner 批"生产激活"时要带的证据。
 *
 * 🔴🔴 本脚本【不签任何东西、不碰 relay、不改任何行】。它只是把纯函数
 *   `evaluateSignReqAnchors` 喂上历史数据看它会说什么。
 *
 * 🔴🔴 最要紧的一格 —— **离线重放【判不了链上那两条】, 这里不许把它糊成一个 100% 弃权率**:
 *   判定序里 `inputTotalSompi` 离线必然取不到 ⇒ 若直接跑, 每一盘都停在
 *   `CHAIN_VALUE_UNAVAILABLE` ⇒ 得到"159/159 = 100% 弃权"。**那个数恒真, 对 Owner 的决策零信息**
 *   (它测的是"我没有 RPC", 不是"这些条件会拒掉多少真实请求")。
 *   ⇒ 因此本报告把结果切成两半, 并且**只有前一半算数**:
 *     ① **离线可判**: 承重列缺失 / commingled / spine outpoint 身份 / outputs 空 / 数量上界 /
 *        输出面值解析 —— 这些只用本地行与 tx_obj 就能判, **它们的拒签数是真读数**。
 *     ② **离线不可判**: 毛额守恒上界(锚点②)与启发式下界(MUST-FIX-2b)—— 二者都要链上
 *        input 面值。抵达这一步的盘, 本报告记为 `reachedChainGate`, **不计入拒签数**,
 *        因为生产环境里那个值是取得到的, 把"我离线拿不到"报成"生产会弃权"是错的方向。
 *   ⇒ **⇒ 报告里那个"会被拒 N 条"只覆盖 ①。这是等号不是上界: ② 那两条的真实拒签率, 本次没测。**
 *
 * 跑: node scripts/pbs8-2-abstention-replay.mjs        (可 PBS8_DB= 指定库)
 * 只读: DatabaseSync readOnly:true + 单读事务(BEGIN DEFERRED/COMMIT), 同 st02 证据包的钉快照做法 ——
 *   159 盘要跑好几条语句, 不钉快照就可能拼到不同时刻的库状态还出一个 digest。
 * 用 node 内建 node:sqlite(非 better-sqlite3): 新增裸 better-sqlite3 import 会触发 M0a 闸,
 *   而那道闸唯一的合法通道是经人审的 manifest —— 一份只读证据脚本不该去要这个例外。
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { evaluateSignReqAnchors } from '../kasia-console/src/lib/pbs8-2-signreq-anchors.mjs';
import { commingledSpineSet } from '../kasia-console/src/lib/pool-commingle-detect.mjs';

const DB_PATH = process.env.PBS8_DB || 'D:/kanet-tn12/kasia-console/data/console.db';

const SQL_MARKETS = `
  SELECT id, spine_p2sh, spine_lock_tx, maker_relay_id, protocol_version, protocol_status, metadata
    FROM pool_markets
   WHERE json_extract(metadata, '$.phase2_tx_obj') IS NOT NULL
   ORDER BY id`;

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec('BEGIN DEFERRED');
const rows = db.prepare(SQL_MARKETS).all();
// 单源函数, 不内联 SQL(lint-kanet R-COMMINGLE-GUARD 会拦内联;而且复刻谓词 = 两份会各自漂移)
const commingled = commingledSpineSet(db);
const dataVersionPinned = db.prepare('PRAGMA data_version').get().data_version;
db.exec('COMMIT');
db.close();

const byCode = new Map();
const offlineRejections = [];   // ① 离线可判的拒签, 逐条留证
let reachedChainGate = 0;       // ② 抵达链上那两条 ⇒ 离线不可判, 不计入拒签
let passedAll = 0;              // 离线全过且 tx_obj 里没有 chain 依赖(理论上不该出现, 记之以防判据漂移)

for (const r of rows) {
  let txObj = null;
  try { txObj = JSON.parse(r.metadata || '{}').phase2_tx_obj ?? null; } catch { txObj = null; }

  const res = evaluateSignReqAnchors({
    market: { id: r.id, spine_p2sh: r.spine_p2sh, spine_lock_tx: r.spine_lock_tx, maker_relay_id: r.maker_relay_id },
    spineIsCommingled: r.spine_p2sh ? commingled.has(r.spine_p2sh) : null,
    txObj,
    inputTotalSompi: null,   // 🔴 离线: 取不到就是 null, 不许伪造成 0 或本地聚合值
  });

  const code = res.ok ? '__PASSED_ALL__' : res.code;
  byCode.set(code, (byCode.get(code) || 0) + 1);

  if (res.ok) { passedAll++; continue; }
  if (code === 'CHAIN_VALUE_UNAVAILABLE') { reachedChainGate++; continue; }
  offlineRejections.push({
    market_id: r.id,
    protocol_version: r.protocol_version,
    protocol_status: r.protocol_status,
    code,
    reason: res.reason,
    outputs_len: Array.isArray(txObj?.outputs) ? txObj.outputs.length : null,
  });
}

// digest 覆盖【判定结果】而不只是市场 id: 换了判定逻辑但市场集不变时, digest 必须跟着变。
const canonical = offlineRejections.map((x) => `${x.market_id}\t${x.code}`).sort().join('\n');
const resultDigest = createHash('sha256')
  .update(`pbs8-2-abstention-v1\n${rows.length}\n${offlineRejections.length}\n${canonical}`, 'utf8')
  .digest('hex');

const pkg = {
  artifact: 'PBS8-2-ABSTENTION-REPLAY',
  generatedBy: 'scripts/pbs8-2-abstention-replay.mjs',
  database: { path: DB_PATH, dataVersionPinned },
  population: {
    marketsWithPhase2TxObj: rows.length,
    note: '设计 §2.1#2 指定的总体 = 本机带 phase2_tx_obj 的历史市场',
  },
  // ① 真读数
  offlineDecidable: {
    rejected: offlineRejections.length,
    rejectionRateOfPopulation: rows.length ? +(offlineRejections.length / rows.length * 100).toFixed(2) : null,
    detail: offlineRejections,
  },
  // ② 明确排除, 不冒充读数
  offlineUndecidable: {
    reachedChainValueGate: reachedChainGate,
    excludedConditions: ['GROSS_CONSERVATION_VIOLATED (锚点②)', 'OUTPUT_BELOW_HEURISTIC_FLOOR (MUST-FIX-2b)'],
    why: '两条都需要链上 input outpoint 面值; 离线取不到。生产环境取得到 ⇒ 把"我离线拿不到"报成'
       + '"生产会弃权"是错的方向, 故不计入拒签数。这两条的真实拒签率【本次没测】。',
  },
  passedAllOfflineDecidable: passedAll,
  byCode: Object.fromEntries([...byCode.entries()].sort((a, b) => b[1] - a[1])),
  resultDigest,
  scope: '单节点本地库的历史行; 证明这些判定对【本机记录的这批 tx_obj】会说什么, '
       + '不证明别的运营方库里会怎样, 也不是链上观测。',
};

console.log(JSON.stringify(pkg, null, 2));
