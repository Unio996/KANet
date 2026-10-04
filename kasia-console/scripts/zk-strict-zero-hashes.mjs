// zk-strict-zero-hashes.mjs — 账本1850 严格零方案: 离线算出 Owner env 需要的模板 hash(只读, 不连链/不连库/不花钱)。
// 用法: ZK_SYSTEM_SINK_PK=<64hex> ZK_CLAIM_RETIRE_DAA=<int> [ZK_TICKET_SWEEP_DAA=<int>] KASPA_NETWORK=mainnet node scripts/zk-strict-zero-hashes.mjs
// 输出: ZK_CLAIM_TMPL_HASH(KanetTokenClaim 模板 hash, 随 sink/retire_daa 变)、票模板 hash(仅供核对, 不是 env)、TOKEN hash(须仍 = 225ebcde…, 不随本方案变)。
import { resolveSinkConfig } from '../src/lib/zk-sink-config.mjs';
import { computeKanetTokenClaimArtifact, computePoolSideTicketArtifact, computeKttTokenArtifact } from '../src/lib/pool-bshard-artifacts.mjs';
const cfg = resolveSinkConfig();   // env 缺失/非法 ⇒ throw(与生产同一单源)
const H = (c) => c.repeat(32);
const ktt = computeKttTokenArtifact({ amount: 1, ownerCovIdHex: H('11') }).templateHashHex;
const claim = computeKanetTokenClaimArtifact({ marketCovIdHex: H('11'), winnerPkHex: H('22'), amount: 1, tokenTmplHashHex: ktt, ...cfg }).templateHashHex;
const ticket = computePoolSideTicketArtifact({ bettorPk: H('11'), direction: 0, stake: 1, shardPoolId: H('22'), ...cfg }).templateHashHex;
console.log(JSON.stringify({ ZK_SYSTEM_SINK_PK: cfg.sinkPkHex, ZK_CLAIM_RETIRE_DAA: cfg.retireDaa, ZK_TICKET_SWEEP_DAA: cfg.sweepDaa, ZK_TOKEN_TMPL_HASH: ktt, ZK_CLAIM_TMPL_HASH: claim, ticket_tmpl_hash_for_reference: ticket }, null, 2));
