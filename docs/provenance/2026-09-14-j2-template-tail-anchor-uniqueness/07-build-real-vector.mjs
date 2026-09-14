import { compileSilV100, ctorBytes32V100, ctorIntV100 } from '../../../kasia-console/src/lib/pool-bshard-artifacts.mjs';
import { writeFileSync } from 'node:fs';

const Z32 = '00'.repeat(32);
const byteNode = (n) => ({ kind: 'byte', value: n });
const bytesNode = (arr) => ({ kind: 'bytes', value: arr });

const sldCtor = [
  ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorBytes32V100(Z32),
  ctorIntV100(2), ctorIntV100(1),
  ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorBytes32V100(Z32),
  ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
];
const sldScript = Buffer.from(compileSilV100('./src/lib/ShardLeaf_direct.sil', sldCtor, 'ShardLeaf_direct').script);
const TAIL_LEN = 132;
const realTail = sldScript.subarray(sldScript.length - TAIL_LEN);
console.log('真实 ShardLeaf_direct 132 字节稳定尾部(hex):');
console.log(realTail.toString('hex'));
writeFileSync('../docs/provenance/2026-09-14-j2-template-tail-anchor-uniqueness/real-market-tmpl-suffix.hex', realTail.toString('hex'));

// 顺手编译 KTT 用这个真实尾部作 market_tmpl_suffix, 确认能正常编译过。
const kttCtor = [
  ctorIntV100(100), ctorBytes32V100('11'.repeat(32)), byteNode(4), byteNode(0), ctorBytes32V100(Z32), ctorBytes32V100(Z32),
  bytesNode([...realTail]), ctorIntV100(TAIL_LEN), ctorIntV100(5), ctorIntV100(3),
];
const kttScript = compileSilV100('./src/lib/sil-v1/KanetTestToken.sil', kttCtor, 'KanetTestToken');
console.log('KTT(真实 market_tmpl_suffix) 编译成功, 脚本长度:', kttScript.script.length);

// —— 生成 ③ 真实对接向量(cli-debugger test.json): 正向(尾部真实匹配) + 负向(尾部改 1 字节) +
//    负向(covenant_id 不匹配但尾部正确) 三条, 供 D-019 pin 的 v1.0.0 cli-debugger 跑 --run-all。——
const REAL_TAIL = realTail.toString('hex');
const owner = '11'.repeat(32);
const wrongOwner = '22'.repeat(32);
const zero32 = '00'.repeat(32);
const constructorArgs = [100, '0x' + owner, 4, 0, '0x' + zero32, '0x' + zero32, '0x' + REAL_TAIL, TAIL_LEN, 3, 3];
const baseArgs = () => [
  [{ amount: 100, owner: '0x' + owner, owner_scheme: 4, borrow_scheme: 0, borrow_guard: '0x' + zero32, extension_commitment: '0x' + zero32 }],
  '0x', [2, 2], [2],
];
const baseTx = (sigHex, marketCovId) => ({
  active_input_index: 0,
  inputs: [
    { utxo_value: 1, covenant_id: '0x' + 'aa'.repeat(32), state: { amount: 60, owner: '0x' + owner, owner_scheme: 4, borrow_scheme: 0, borrow_guard: '0x' + zero32, extension_commitment: '0x' + zero32 } },
    { utxo_value: 1, covenant_id: '0x' + 'aa'.repeat(32), state: { amount: 40, owner: '0x' + owner, owner_scheme: 4, borrow_scheme: 0, borrow_guard: '0x' + zero32, extension_commitment: '0x' + zero32 } },
    { utxo_value: 10, covenant_id: marketCovId, signature_script_hex: sigHex },
  ],
  outputs: [
    { value: 1, covenant_id: '0x' + 'aa'.repeat(32), state: { amount: 100, owner: '0x' + owner, owner_scheme: 4, borrow_scheme: 0, borrow_guard: '0x' + zero32, extension_commitment: '0x' + zero32 } },
  ],
});
const flippedLastByte = (hex) => { const buf = Buffer.from(hex, 'hex'); buf[buf.length - 1] ^= 0xff; return buf.toString('hex'); };

const testFile = {
  tests: [
    {
      name: 'REAL-V1_pass_market_sigscript_tail_matches_real_shardleafdirect_132byte_stable_tail',
      function: 'transfer', constructor_args: constructorArgs, args: baseArgs(), expect: 'pass',
      tx: baseTx('00' + REAL_TAIL, '0x' + owner),
    },
    {
      name: 'REAL-V2_fail_market_sigscript_tail_one_byte_off_from_real_shardleafdirect_tail',
      function: 'transfer', constructor_args: constructorArgs, args: baseArgs(), expect: 'fail',
      tx: baseTx('00' + flippedLastByte(REAL_TAIL), '0x' + owner),
    },
    {
      name: 'REAL-V3_fail_market_covenant_id_mismatch_despite_correct_sigscript_tail',
      function: 'transfer', constructor_args: constructorArgs, args: baseArgs(), expect: 'fail',
      tx: baseTx('00' + REAL_TAIL, '0x' + wrongOwner),
    },
  ],
};
writeFileSync('../docs/provenance/2026-09-14-j2-template-tail-anchor-uniqueness/ktt-real-vector.test.json', JSON.stringify(testFile, null, 1));
console.log('已生成 ktt-real-vector.test.json (3 条向量: 正向1 + 负向-尾部改1字节 + 负向-covenant_id不匹配)');
