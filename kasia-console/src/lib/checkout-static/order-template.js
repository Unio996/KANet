// order-template.js — 浏览器端订单地址推导, 不调用 silverc.exe(D-034 §8 后续票①第二轮)。
//
// 🔴 上一轮结论是错的, 本轮已推翻(如实记录, 不是悄悄改口): 上一轮以为 CommissionSplit.sil 的原生
// `int` ctor 字段是变长编码("array literal element type mismatch" + 读 silverc 源码 `compile.rs`
// 确认 `int(...)` 转型是纯透传), 因此判定"固定偏移 splice"不可安全达成、建议关闭这个方向。
// **这个判断本身没有说谎, 但推导它的那次 offset 探测方法有一个没被发现的漏洞**: 用两个"随手挑的"
// 哨兵值(比如 700,000,000 和 1)做字节 diff, 只能测出"这两个具体值恰好不同的那一段字节区间"——如果
// 两个值的高位字节恰好都是 0x00(两者都远小于字段真实宽度能装下的最大值), diff 算法会把"巧合相同的
// 尾部零字节"错误地排除在外, 报告出一个比字段真实宽度更短的区间。这正是上一轮发生的事——role1_amt
// 在(700,000,000 vs 1)这组对比里 diff 出 4 字节, 但真实字段宽度是 8 字节(参见下方证据)。
//
// 本轮独立重新验证(不是听信 Bettor 的判断, 是自己重新编译测出来的), 三条独立证据:
//   ① 全字段总脚本长度在 int 字段取值覆盖 0 到 Number.MAX_SAFE_INTEGER(2^53-1)的整个范围内恒定
//      不变(CommissionSplit=1747 字节, ChannelDeposit=106 字节)——如果字段宽度真的随数值变化,
//      总长度不可能保持恒定。
//   ② 直接读字节: 每个 int 字段在编译产物里都是"0x08(push-8 opcode) + 8 字节小端数据"这个固定
//      9 字节结构, 数值 0/1/2^40-1/2^40/2^53-1 等一律如此, 从不出现"更短的 push 操作码"。
//   ③ 220 组随机向量(覆盖 1-7 角色、P2PK/P2PK-ECDSA/P2SH 三种真实地址类型、极端金额)与真实
//      silverc 编译产物逐字节比对, 220/220 一致; ChannelDeposit 另外 60/60 一致。证据见
//      docs/provenance/2026-09-27-j2-checkout-pure-static-r2/。
//
// 结论: ctor 数值字段不是变长的——它们在**这份已经合入生产的 .sil 源码**里被编译成固定 8 字节槽位
// (这是 silverc 对"直接作为 ctor 参数值使用、参与比较/算术的 int"这个用法模式的编译期决定, 跟"源码
// 里写一个 int 字面量数组元素"是两回事, 上一轮判定的"int(byte[8])转型是纯透传"这条技术事实本身没错,
// 只是它跟"ctor 字段是否固定宽度"是两个独立的问题, 被错误地当成了同一个问题的证据)。
// **不需要改 .sil 源码的 ctor 类型**(上一轮那次改动已经还原、生产合约未受影响)——直接对已合入的
// CommissionSplit.sil/ChannelDeposit.sil 编译产物做固定偏移覆写就是正确、安全、已验证的。

// ── CommissionSplit: 编译一次(全零占位值)得到的基准模板, 后续只覆写, 不重新编译 ──
export const CS_TEMPLATE_HEX = '6b0807000000000000002500000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000080000000000000000250000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000008000000000000000025000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000800000000000000002500000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000080000000000000000250000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000008000000000000000025000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000800000000000000002500000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000080000000000000000250000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000008000000000000000008000000000000000008000000000000000020000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000006c7604cc1c91af876375011e7982529f6975b3519c69011d7951a269011d7957a169011d79519c6300c2011b799c6900c3011d7900011e797f8769011a79011f7963b9be78945679a069b4529c6951c35979005a797f876951c2b9be527994577994a26967b4519c69b9be78945679a169687567011d79529c6300c2011b799c6900c3011d7900011e797f876951c20118799c6951c3011a7900011b797f8769011a7901187993011f7963b9be78945679a069b4539c6952c35979005a797f876952c2b9be527994577994a26967b4529c69b9be78945679a169687567011d79539c6300c2011b799c6900c3011d7900011e797f876951c20118799c6951c3011a7900011b797f876952c20115799c6952c3011779000118797f8769011a790118799301157993011f7963b9be78945679a069b4549c6953c35979005a797f876953c2b9be527994577994a26967b4539c69b9be78945679a169687567011d79549c6300c2011b799c6900c3011d7900011e797f876951c20118799c6951c3011a7900011b797f876952c20115799c6952c3011779000118797f876953c20112799c6953c3011479000115797f8769011a79011879930115799301127993011f7963b9be78945679a069b4559c6954c35979005a797f876954c2b9be527994577994a26967b4549c69b9be78945679a169687567011d79559c6300c2011b799c6900c3011d7900011e797f876951c20118799c6951c3011a7900011b797f876952c20115799c6952c3011779000118797f876953c20112799c6953c3011479000115797f876954c25f799c6954c3011179000112797f8769011a790118799301157993011279935f7993011f7963b9be78945679a069b4569c6955c35979005a797f876955c2b9be527994577994a26967b4559c69b9be78945679a169687567011d79569c6300c2011b799c6900c3011d7900011e797f876951c20118799c6951c3011a7900011b797f876952c20115799c6952c3011779000118797f876953c20112799c6953c3011479000115797f876954c25f799c6954c3011179000112797f876955c25c799c6955c35e79005f797f8769011a790118799301157993011279935f79935c7993011f7963b9be78945679a069b4579c6956c35979005a797f876956c2b9be527994577994a26967b4569c69b9be78945679a16968756700c2011b799c6900c3011d7900011e797f876951c20118799c6951c3011a7900011b797f876952c20115799c6952c3011779000118797f876953c20112799c6953c3011479000115797f876954c25f799c6954c3011179000112797f876955c25c799c6955c35e79005f797f876956c259799c6956c35b79005c797f8769011a790118799301157993011279935f79935c7993597993011f7963b9be78945679a069b4589c6957c35979005a797f876957c2b9be527994577994a26967b4579c69b9be78945679a16968756868686868687575757575757575757575757575757575757575757575757575757575757551677604777f5b11876375b3519c69557976050088526a74a269b0b4519c6900c358790059797f876900c2b9be557994a26975757575757575757575757575757575757575757575757575757575757551676a6868';

export const CD_TEMPLATE_HEX = '6b2000000000000000000000000000000000000000000000000000000000000000000800000000000000006c760480344ff187637552798201419d7552795279ac69b3519c690300002052797e01ac7eb4519c6900c378876900c2b9be537994a2697575757551676a68';

// ── NWT MUST(diff 审 2026-09-27T11-37Z, 一条 MUST 放行合并的条件): 上面两份 TEMPLATE_HEX 是从
// CommissionSplit.sil/ChannelDeposit.sil 某一次真实编译"手工"抽出来的固定字节模板——但此前没有任何
// 机制核过"如果源码后来改了, 这份模板是不是已经过期"。两份 wasm pin(kaspa-wasm-web-pin.json/
// silverc-wasm-pin.json)只锚 wasm 二进制本身, 不覆盖这条链路(降级路径压根不跑 wasm, 不经过那两份
// pin 的校验路径)——这是一条独立的、此前完全没被守住的过期风险。
//
// 处置(照本仓 R-FEE-SPLIT-PKG-DRIFT 同一封闭式防护原则——不是"信任模板还对", 是"每次都验证还对
// 不对", 源码变了立刻在两处显形):
//   ① 下面两个常量记录**生成上面两份 TEMPLATE_HEX 时**源码的 sha256(命令见常量旁注释, 可重放)。
//   ② lint-kanet.mjs 的 R-SPLICE-TEMPLATE-SIL-DRIFT[ERROR]: 每次 commit 重算 CommissionSplit.sil/
//      ChannelDeposit.sil 的真实 sha256, 与下面两个常量不一致就拒绝 commit——源码改了但没人手工
//      重新编译+替换 TEMPLATE_HEX, 在你想提交那一刻就会被挡下来, 不是留到运行时才发现。
//   ③ 运行时(resolve-order-browser.js 的 deriveCommissionOrderAddress): 调用方必须传入"随页面
//      一起发布的 CommissionSplit.sil 源码"的 sha256(checkout.js 已经在 fetch 这份源码用于 wasm
//      主路径, 顺手算它的 sha256 零额外成本)——跟下面的 CS_SOURCE_SHA256 不一致, 降级路径
//      fail-closed(拒绝生成地址、明确报错), 不是"凑合用一份可能过期的模板"。
//
// 重新生成命令(源码改了、真要更新模板时用): sha256sum kasia-console/src/lib/sil-v1/CommissionSplit.sil
// kasia-console/src/lib/sil-v1/ChannelDeposit.sil ——同时必须重新走 docs/provenance/
// 2026-09-27-j2-checkout-pure-static-r2/ 里 build_and_verify_template_splicer.mjs 那一套重新抽取
// TEMPLATE_HEX/CS_FIELDS/CD_FIELDS 并重新跑 parity, 不能只改这两个 sha256 常量了事。
export const CS_SOURCE_SHA256 = '72bc6bf978ca240dcd6714c8c42acea88f8b04cc4026ba8ab3a8725ff49fe83a';
export const CD_SOURCE_SHA256 = '7333a59c7a615b67faa7570c1d1f283145686e07437ca18d2452c4b12c954a78';

// ── 字段布局(逐字节比对 real vs spliced 220/220 与 60/60 完全一致验证过, 见 verify-core.js 头注
// 同一份"零 import 与生产 SDK 各自独立算, 靠 parity 测试守住不分叉"纪律) ──
export const CS_FIELDS = [
  { name: 'role_count', kind: 'int', offset: 2 },
  { name: 'role1_spk', kind: 'bytes', offset: 11, len: 37 }, { name: 'role1_len', kind: 'int', offset: 49 }, { name: 'role1_amt', kind: 'int', offset: 58 },
  { name: 'role2_spk', kind: 'bytes', offset: 67, len: 37 }, { name: 'role2_len', kind: 'int', offset: 105 }, { name: 'role2_amt', kind: 'int', offset: 114 },
  { name: 'role3_spk', kind: 'bytes', offset: 123, len: 37 }, { name: 'role3_len', kind: 'int', offset: 161 }, { name: 'role3_amt', kind: 'int', offset: 170 },
  { name: 'role4_spk', kind: 'bytes', offset: 179, len: 37 }, { name: 'role4_len', kind: 'int', offset: 217 }, { name: 'role4_amt', kind: 'int', offset: 226 },
  { name: 'role5_spk', kind: 'bytes', offset: 235, len: 37 }, { name: 'role5_len', kind: 'int', offset: 273 }, { name: 'role5_amt', kind: 'int', offset: 282 },
  { name: 'role6_spk', kind: 'bytes', offset: 291, len: 37 }, { name: 'role6_len', kind: 'int', offset: 329 }, { name: 'role6_amt', kind: 'int', offset: 338 },
  { name: 'role7_spk', kind: 'bytes', offset: 347, len: 37 }, { name: 'role7_len', kind: 'int', offset: 385 }, { name: 'role7_amt', kind: 'int', offset: 394 },
  { name: 'refund_spk', kind: 'bytes', offset: 403, len: 37 }, { name: 'refund_len', kind: 'int', offset: 441 },
  { name: 'deadline_ms', kind: 'int', offset: 450 }, { name: 'max_split_fee', kind: 'int', offset: 459 }, { name: 'max_refund_fee', kind: 'int', offset: 468 },
  { name: 'rule_commit', kind: 'bytes', offset: 477, len: 32 }, { name: 'channel_chain_commitment', kind: 'bytes', offset: 510, len: 32 }, { name: 'order_nonce', kind: 'bytes', offset: 543, len: 16 },
];
export const CD_FIELDS = [
  { name: 'depositor_pk', kind: 'bytes', offset: 2, len: 32 },
  { name: 'max_withdraw_fee', kind: 'int', offset: 35 },
];
export const INT_DATA_LEN = 8; // 固定 8 字节小端(非负值; 本设计所有数值字段——金额/时间戳/计数——恒非负, 不需要处理符号位)

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function writeUInt64LE(target, offset, value) {
  let v = BigInt(value);
  for (let i = 0; i < 8; i++) { target[offset + i] = Number(v & 0xffn); v >>= 8n; }
}

/** spliceScript — 通用固定偏移覆写: 复制模板字节, 按字段表逐个写入真实值, 不重新调用 silverc。
 * @param {string} templateHex
 * @param {{name:string,kind:'bytes'|'int',offset:number,len?:number}[]} fields
 * @param {Object<string, Uint8Array|number[]|bigint|number>} valuesByName
 */
export function spliceScript(templateHex, fields, valuesByName) {
  const out = hexToBytes(templateHex);
  for (const f of fields) {
    const v = valuesByName[f.name];
    if (v === undefined) throw new Error(`spliceScript: missing value for field '${f.name}'`);
    if (f.kind === 'bytes') {
      const bytes = v instanceof Uint8Array ? v : new Uint8Array(v);
      if (bytes.length !== f.len) throw new Error(`spliceScript: field '${f.name}' expects ${f.len} bytes, got ${bytes.length}`);
      out.set(bytes, f.offset);
    } else {
      writeUInt64LE(out, f.offset, v);
    }
  }
  return out;
}

export function spliceCommissionSplitScript(valuesByName) { return spliceScript(CS_TEMPLATE_HEX, CS_FIELDS, valuesByName); }
export function spliceChannelDepositScript(valuesByName) { return spliceScript(CD_TEMPLATE_HEX, CD_FIELDS, valuesByName); }
