// proto-convert-to-rootclose-witness.mjs — ShardLeaf_direct.convert_to_rootclose(market_seal)的
// 真实 entry witness ABI 编码(J2 2026-09-19, 实现计划v0.2 §2.1批3)。
//
// 🔴 与 proto-register-append-witness.mjs 不同: 那个是硬编码固定 10 参数顺序的专用编码器
// (账本1425/1431 已用真实 cli-debugger 逐字节验证过对应关系)。本文件对 convert_to_rootclose
// **没有做过同等的独立 debugger 逐字节验证**——参数顺序改为**动态从真实编译产物的
// entryAbi.params 读取并按声明顺序逐个编码**(不是硬编码假设的顺序), 这是账本1473结算审计阶段
// `kasia-console/scripts/audit/generic-entry-witness.mjs`(已修复双重hex编码bug, commit 449745f4,
// 与专用编码器逐字节自检一致过)的编码算法原样移植——编码规则本身(D-019 pin
// silverscript-abi/src/lib.rs:904-946 push_sig_arg)已经过验证, 只是"按 params 声明顺序动态编码"
// 这个更通用的做法本来就不依赖硬编码参数名/顺序, 天然对得上任意真实编译产物, 不需要为每个新 entry
// 重新做一次"硬编码顺序"的验证——这是设计上更安全的选择, 不是省略验证。
//
// 编码规则(D-019 pin 3ed9733, 与账本1425/1473已验证的规则完全一致):
//   int/temporal -> add_i64; bool -> add_i64(0/1); byte -> add_data([b]); bytes -> add_data(raw);
//   text -> add_data(utf8); pubkey -> add_data(32B); sig -> add_data(65B); datasig -> add_data(64B);
//   fixed_bytes{len} -> add_data(len B); fixed_array/dynamic_array(非struct) -> 拼接每个元素的
//   定长payload(无长度前缀)后整体一次 add_data 推。全部 param 推完后, 最后 add_data(dispatch_tag)。
// combineActionAndRedeem: action ++ pushdata(redeem_bytes)(debugger/cli/src/main.rs 同名函数)。
//
// 🔴 kaspa-wasm坑(账本1473自我纠错, 全仓多处踩过): kaspa.ScriptBuilder.drain()返回hex**字符串**,
// 不是字节——encodeConvertToRootcloseAction 返回值是这个hex字符串本身(不转Buffer), 调用方按需
// hexToBytes; combineActionAndRedeem 的入参也必须是这个hex字符串(kaspa.ScriptBuilder.fromScript
// 需要hex字符串), 只在最终返回给调用方时才转真实字节Buffer(用'hex'正确解码, 不能再犯
// Buffer.from(hexString)当UTF8文本二次编码这个坑)。

function hexToBytes(h) {
  if (Buffer.isBuffer(h)) return h;
  if (Array.isArray(h)) return Buffer.from(h);
  if (typeof h === 'string') return Buffer.from(h.startsWith('0x') ? h.slice(2) : h, 'hex');
  throw new Error(`hexToBytes: unsupported value ${JSON.stringify(h)}`);
}

function encodeFixedPayload(ty, value) {
  switch (ty.kind) {
    case 'int': case 'temporal': { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(value)); return b; }
    case 'bool': return Buffer.from([value ? 1 : 0]);
    case 'byte': return Buffer.from([Number(value)]);
    case 'pubkey': { const b = hexToBytes(value); if (b.length !== 32) throw new Error(`pubkey must be 32B, got ${b.length}`); return b; }
    case 'sig': { const b = hexToBytes(value); if (b.length !== 65) throw new Error(`sig must be 65B, got ${b.length}`); return b; }
    case 'datasig': { const b = hexToBytes(value); if (b.length !== 64) throw new Error(`datasig must be 64B, got ${b.length}`); return b; }
    case 'fixed_bytes': { const b = hexToBytes(value); if (b.length !== ty.len) throw new Error(`fixed_bytes(${ty.len}) got ${b.length}`); return b; }
    case 'fixed_array': {
      if (!Array.isArray(value) || value.length !== ty.len) throw new Error(`fixed_array len ${ty.len} mismatch`);
      return Buffer.concat(value.map((v) => encodeFixedPayload(ty.item, v)));
    }
    default: throw new Error(`encodeFixedPayload: unsupported nested type kind=${ty.kind}`);
  }
}

function encodeArrayPayload(ty, value) {
  if (!Array.isArray(value)) throw new Error(`encodeArrayPayload: value must be array for ${ty.kind}`);
  if (ty.kind === 'fixed_array' && value.length !== ty.len) throw new Error(`fixed_array expects len=${ty.len}, got ${value.length}`);
  return Buffer.concat(value.map((v) => encodeFixedPayload(ty.item, v)));
}

/**
 * @param {object} kaspa kaspa-wasm(注入)
 * @param {object} entryAbi compileSilV100(...)._raw.contracts.ShardLeaf_direct.entries.convert_to_rootclose
 *   (真实编译产物, 含 dispatch_tag + params[]——调用方每次现读, 不缓存跨市场复用)
 * @param {object} argsByName { paramName: value, ... }——真实参数名见该市场当前编译产物的
 *   entries.convert_to_rootclose.params(典型: rcOutIdx/rc_prefix/rc_suffix/tokenInIdx/tokenOutIdx/
 *   tok_prefix/tok_suffix, 但本函数不假设固定顺序, 按真实编译产物声明顺序编码)
 * @returns {string} action 的 hex 字符串(不含 redeem, 不转Buffer——同 combineActionAndRedeem 配对使用)
 */
export function encodeConvertToRootcloseAction(kaspa, entryAbi, argsByName) {
  if (!entryAbi?.dispatch_tag) throw new Error('encodeConvertToRootcloseAction: entryAbi.dispatch_tag missing(传入的是不是 compileSilV100 产物的 entries.convert_to_rootclose?)');
  const b = new kaspa.ScriptBuilder({ flags: { covenantsEnabled: true } });
  for (const p of entryAbi.params) {
    if (!(p.name in argsByName)) throw new Error(`encodeConvertToRootcloseAction: missing arg '${p.name}' (entry params: ${entryAbi.params.map(x => x.name).join(',')})`);
    const v = argsByName[p.name];
    const ty = p.type;
    switch (ty.kind) {
      case 'int': case 'temporal': b.addI64(BigInt(v)); break;
      case 'bool': b.addI64(v ? 1n : 0n); break;
      case 'byte': b.addData(Buffer.from([Number(v)])); break;
      case 'bytes': b.addData(hexToBytes(v)); break;
      case 'text': b.addData(Buffer.from(String(v), 'utf8')); break;
      case 'pubkey': { const bb = hexToBytes(v); if (bb.length !== 32) throw new Error(`${p.name}: pubkey must be 32B`); b.addData(bb); break; }
      case 'sig': { const bb = hexToBytes(v); if (bb.length !== 65) throw new Error(`${p.name}: sig must be 65B, got ${bb.length}`); b.addData(bb); break; }
      case 'datasig': { const bb = hexToBytes(v); if (bb.length !== 64) throw new Error(`${p.name}: datasig must be 64B`); b.addData(bb); break; }
      case 'fixed_bytes': { const bb = hexToBytes(v); if (bb.length !== ty.len) throw new Error(`${p.name}: fixed_bytes(${ty.len}) got ${bb.length}`); b.addData(bb); break; }
      case 'fixed_array': b.addData(encodeArrayPayload(ty, v)); break;
      case 'dynamic_array': b.addData(encodeArrayPayload(ty, v)); break;
      default: throw new Error(`encodeConvertToRootcloseAction: unsupported top-level param kind '${ty.kind}' for ${p.name}`);
    }
  }
  b.addData(hexToBytes(entryAbi.dispatch_tag));
  return b.drain(); // hex string(无0x前缀), 不转Buffer——见文件头注kaspa-wasm坑
}

/** action ++ pushdata(redeem) — 同 debugger/cli/src/main.rs combine_action_and_redeem。
 * @param {string} actionHex encodeConvertToRootcloseAction 的返回值(hex字符串, 无0x前缀) */
export function combineActionAndRedeem(kaspa, actionHex, redeemScriptBytes) {
  if (typeof actionHex !== 'string') throw new Error('combineActionAndRedeem: actionHex must be the hex string returned by encodeConvertToRootcloseAction, not a Buffer');
  const b = kaspa.ScriptBuilder.fromScript(actionHex, { flags: { covenantsEnabled: true } });
  b.addData(hexToBytes(redeemScriptBytes));
  return Buffer.from(b.drain(), 'hex'); // 真实字节, 用'hex'正确解码
}
