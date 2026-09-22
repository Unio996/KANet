// make-market.mjs — F1 对抗重跑: 直接建一个非判定题市场(跳过 oracle 校验层, 与本次要测的东西正交),
// 真 computeMarketGenesisArtifacts + 真 ensureMarketPending(与 harness-lib.createJudgedMarket 内部同一批函数, 只是不走判定题校验)。
// deadline_ms 显式传入(本轮设计: 定死在已冻结的 pmt 值之前, 见 README)。
// 用法: node make-market.mjs <label> <deadlineMs> [sealCount=1]
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

const RUN = 'D:/kanet-tn12/scratch/_nwt_append_badbytes_matrix';
const WT = 'D:/kanet-tn12/scratch/_nwt_wt_f1adv_review';
for (const line of fs.readFileSync(`${RUN}/kanet.simnet.env`, 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
if (process.env.KASPA_NETWORK !== 'simnet' || !process.env.DB_PATH.includes('_nwt_append_badbytes_matrix')) { console.error('REFUSE: 不是隔离 simnet 配置'); process.exit(2); }
const state = JSON.parse(fs.readFileSync(`${RUN}/state.json`, 'utf8'));
const lib = (rel) => import(pathToFileURL(`${WT}/kasia-console/src/${rel}`).href);
const [label, deadlineMsArg, sealCountArg] = process.argv.slice(2);
const deadlineMs = Number(deadlineMsArg);
const sealCount = sealCountArg ? Number(sealCountArg) : 1;
if (!label || !Number.isFinite(deadlineMs)) { console.error('用法: node make-market.mjs <label> <deadlineMs> [sealCount=1]'); process.exit(2); }

const { computeMarketGenesisArtifacts } = await lib('lib/proto-covenant-builder.mjs');
const { ensureMarketPending } = await lib('lib/proto-market-intent.mjs');
const id = randomBytes(32).toString('hex');
const minBet = 1;
const artifacts = await computeMarketGenesisArtifacts({ marketId: id, minBet, deadlineMs });
ensureMarketPending({
  id, token_def_id: state.tokenId, question: `f1adv ${label}`, deadline_ms: deadlineMs, min_bet: minBet, seal_count: sealCount,
  committee_pubkeys_json: JSON.stringify([artifacts.committeePubkeyHex]), committee_privkey_enc: artifacts.committeePrivkeyEnvelope,
  rootclose_tmpl_hash: artifacts.rootCloseTmplHash, shardleaf_own_redeem_len: artifacts.shardLeafOwnRedeemLen,
});
const armsFile = `${RUN}/arms.json`; const arms = fs.existsSync(armsFile) ? JSON.parse(fs.readFileSync(armsFile, 'utf8')) : {};
arms[label] = id; fs.writeFileSync(armsFile, JSON.stringify(arms, null, 1));
const rec = (o) => fs.appendFileSync(`${RUN}/evidence/actions.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n');
rec({ action: 'make_market_plain', label, marketId: id, deadlineMs, deadlineIso: new Date(deadlineMs).toISOString(), sealCount });
console.log(JSON.stringify({ label, id, deadlineIso: new Date(deadlineMs).toISOString(), sealCount }));
process.exit(0);
