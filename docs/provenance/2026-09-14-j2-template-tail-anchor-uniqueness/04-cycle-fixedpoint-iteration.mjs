// _j2_verify_cycle.mjs — Bettor 追问③: ShardLeaf_direct ctor 烤 token_tmpl_hash, KanetTestToken ctor 烤
// market_tmpl_suffix——若两者互相引用对方的编译产物, 是不是一个编译期环? 用真实编译做不动点迭代实测:
// 从占位 token_tmpl_hash=Z32 出发, 编译 ShardLeaf_direct 拿 suffix_v1, 拿它去编译 KTT 拿 hash_v1,
// 再拿 hash_v1 重编 ShardLeaf_direct 拿 suffix_v2——如果 suffix_v2 != suffix_v1, 证明朴素代入不收敛
// (至少证明这条链条真实存在依赖, 不是空想)。
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from '../../../kasia-console/src/lib/pool-bshard-artifacts.mjs';
import { extractTemplateArtifact } from '../../../kasia-console/src/lib/pool-template-artifact.mjs';

const Z32 = '00'.repeat(32);
const byteNode = (n) => ({ kind: 'byte', value: n });
const bytesNode = (arr) => ({ kind: 'bytes', value: arr });

function shardLeafDirectArtifact(tokenTmplHashHex) {
  const ctor = [
    ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorBytes32V100(Z32),
    ctorIntV100(2), ctorIntV100(1),
    ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorBytes32V100(tokenTmplHashHex),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
  ];
  const c = compileSilV100('./src/lib/ShardLeaf_direct.sil', ctor, 'ShardLeaf_direct');
  return extractTemplateArtifact(c);
}

function ktkArtifact(marketTmplSuffixBytes) {
  const ctor = [
    ctorIntV100(0), ctorBytes32V100(Z32), byteNode(4), byteNode(0), ctorBytes32V100(Z32), ctorBytes32V100(Z32),
    bytesNode([...marketTmplSuffixBytes]), ctorIntV100(marketTmplSuffixBytes.length),
    ctorIntV100(3), ctorIntV100(3),
  ];
  const c = compileSilV100('./src/lib/sil-v1/KanetTestToken.sil', ctor, 'KanetTestToken');
  return extractTemplateArtifact(c);
}

console.log('=== 不动点迭代: token_tmpl_hash ⇄ market_tmpl_suffix ===');
console.log('第0轮: token_tmpl_hash 占位 = Z32');
const sl1 = shardLeafDirectArtifact(Z32);
console.log('  → ShardLeaf_direct.suffix_v1 长度:', sl1.templateSuffix.length, 'hash(仅供参考):', sl1.expectedTemplateHashHex.slice(0, 16));

// KTT market_tmpl_suffix 是 byte[](变长), 但为了让实验可控, 只取 suffix_v1 的一个固定长度切片(比如尾部 20 字节)
// 模拟"KTT 只关心尾部一小段"这个真实设计意图(market_tmpl_suffix_len 是可配置长度, 不要求整个 suffix)。
const SUFFIX_TEST_LEN = 20;
const tail1 = sl1.templateSuffix.subarray(sl1.templateSuffix.length - SUFFIX_TEST_LEN);
console.log('  取 suffix_v1 尾部', SUFFIX_TEST_LEN, '字节作为候选 market_tmpl_suffix_v1:', tail1.toString('hex'));

const ktt1 = ktkArtifact(tail1);
console.log('第1轮: 用 market_tmpl_suffix_v1 编译 KTT → token_tmpl_hash_v1 =', ktt1.expectedTemplateHashHex);

const sl2 = shardLeafDirectArtifact(ktt1.expectedTemplateHashHex);
const tail2 = sl2.templateSuffix.subarray(sl2.templateSuffix.length - SUFFIX_TEST_LEN);
console.log('第2轮: 用 token_tmpl_hash_v1 重编 ShardLeaf_direct → suffix_v2 尾部', SUFFIX_TEST_LEN, '字节:', tail2.toString('hex'));

const converged = Buffer.compare(tail1, tail2) === 0;
console.log('\n' + (converged
  ? '✅ suffix_v1 == suffix_v2 —— 巧合收敛(不代表无环, 但至少这一步没立刻发散; 仍需多轮验证是否真稳定不动点)'
  : '🔴 suffix_v1 != suffix_v2 —— 朴素代入一轮就已经不收敛, 证实这是真实存在的相互依赖(token_tmpl_hash 的值改变了, 导致 ShardLeaf_direct 编译产物的对应尾部字节也跟着变了, 而这尾部字节本身又是用来定义 market_tmpl_suffix 的输入)。'));

// 额外诊断: token_tmpl_hash 的 32 字节到底有没有原样出现在 ShardLeaf_direct 编译产物里(直接字节搜索,
// 不依赖 state_layout 假设, 排他性确认"ctor 值被原样 push 进字节码"这件事本身)。
const needle = Buffer.from(ktt1.expectedTemplateHashHex, 'hex');
const haystack = sl2.templateSuffix;
const foundAt = haystack.indexOf(needle);
console.log('\n诊断: token_tmpl_hash_v1(32 字节) 是否原样出现在重编译后的 ShardLeaf_direct suffix 里:', foundAt >= 0 ? `是, offset=${foundAt}` : '否(可能被编码/混合/优化掉, 需要进一步分析)');
