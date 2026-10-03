// abi_probe.mjs — 用 pinned silverc v1.0.0 编 PayoutShardV2/ShardLeaf, 打印各 entry 的 dispatch_tag 与参数 ABI(段1 witness 编码依据)。
process.env.DB_PATH = (process.env.TEMP || '/tmp') + '/_j2_tok_probe.db'; process.env.KASPA_NETWORK = 'simnet'; process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
import { pathToFileURL } from 'node:url';
const imp = (p) => import(pathToFileURL(`D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/${p}`).href);
const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await imp('lib/pool-bshard-artifacts.mjs');
const H = (c) => c.repeat(64);
// 直接再编一次拿 _raw
import { join } from 'node:path';
const LIB = 'D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/lib';
const z32 = '00'.repeat(32);
const W = Array.from({ length: 17 }, () => ctorIntV100(0));
const ctor = [ctorBytes32V100(H('1')), ctorBytes32V100(H('2')), ctorBytes32V100(H('3')), ctorBytes32V100(H('4')), ctorIntV100(0), ctorIntV100(0), ctorBytes32V100(z32), ...W, ctorIntV100(-1), ctorIntV100(0), ctorBytes32V100(z32), ctorBytes32V100(z32), ctorBytes32V100(H('5'))];
const c = compileSilV100(join(LIB, 'PayoutShardV2.sil'), ctor, 'PayoutShardV2');
const ents = c._raw.contracts.PayoutShardV2.entries;
for (const [n, e] of Object.entries(ents)) console.log('PSV2.' + n, JSON.stringify(e).slice(0, 700));
console.log('state_span', JSON.stringify(c.state_layout));
process.exit(0);
