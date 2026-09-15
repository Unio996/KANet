// generic-entry-witness.mjs — 账本1473 settlement Step-0审计专用: 通用entry witness ABI编码器。
// 不是生产代码(放scratch, 不进src/lib) —— 只用于本次只读审计构造"真实形状"的sigScript喂cli-debugger,
// 不广播、不碰生产库。
//
// 编码规则逐字节对照 D-019 pin(3ed9733) silverscript-abi/src/lib.rs push_sig_arg (真实源码读出, 非猜测):
//   int/temporal -> add_i64; bool -> add_i64(0/1); byte -> add_data([b]); bytes/text -> add_data(raw);
//   pubkey -> add_data(32B); sig -> add_data(65B); datasig -> add_data(64B); fixed_bytes{len} -> add_data(len B);
//   fixed_array/dynamic_array(非struct item) -> 拼接每个元素的encode_fixed_payload(定长元素=原始字节,
//     无长度前缀, 无数组长度前缀本身) 后整体一次 add_data 推(不是逐元素多次push)。
// 全部param推完后, 最后加一次 add_data(dispatch_tag)。
// combineActionAndRedeem: action ++ pushdata(redeem_bytes)(debugger/cli/src/main.rs combine_action_and_redeem)。

function hexToBytes(h) {
  if (Buffer.isBuffer(h)) return h;
  if (Array.isArray(h)) return Buffer.from(h);
  if (typeof h === 'string') return Buffer.from(h.startsWith('0x') ? h.slice(2) : h, 'hex');
  throw new Error(`hexToBytes: unsupported value ${JSON.stringify(h)}`);
}

function encodeFixedPayload(ty, value) {
  switch (ty.kind) {
    case 'int': case 'temporal': {
      const b = Buffer.alloc(8);
      b.writeBigInt64LE(BigInt(value));
      return b;
    }
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
 * @param {object} entryAbi compileSilV100(...)._raw.contracts[Contract].entries[entryName] (真实编译产物, 含 dispatch_tag + params[])
 * @param {object} argsByName { paramName: value, ... } — 每个 param.name 对应一个值, int/bool 用 number/bigint,
 *   bytes 用 hex 字符串('0x...')/Buffer/number[], fixed_array/dynamic_array 用 JS 数组(元素同上规则)
 * @returns {Buffer} action bytes(不含 redeem)
 */
export function encodeEntryActionGeneric(kaspa, entryAbi, argsByName) {
  if (!entryAbi?.dispatch_tag) throw new Error('encodeEntryActionGeneric: entryAbi.dispatch_tag missing');
  const b = new kaspa.ScriptBuilder({ flags: { covenantsEnabled: true } });
  for (const p of entryAbi.params) {
    if (!(p.name in argsByName)) throw new Error(`encodeEntryActionGeneric: missing arg '${p.name}' (entry params: ${entryAbi.params.map(x => x.name).join(',')})`);
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
      default: throw new Error(`encodeEntryActionGeneric: unsupported top-level param kind '${ty.kind}' for ${p.name}`);
    }
  }
  b.addData(hexToBytes(entryAbi.dispatch_tag));
  // 🔴 账本1473自我纠错(见provenance/流水记录): kaspa.ScriptBuilder.drain()返回的是【hex字符串】,
  // 不是字节——同proto-register-append-witness.mjs已确认的既有坑(kaspa-wasm一贯行为, 全仓多处踩过
  // 同类"drain()/serializeToJSON返回hex字符串却被Buffer.from()当UTF8文本二次编码"的坑)。此前这里
  // 写的是`return Buffer.from(b.drain())`——把hex字符串"55"当UTF8文本编码成[0x35,0x35]而不是解码
  // 成真正的字节[0x55], 导致这个通用编码器产出的每一个action字节串全部是双重编码的垃圾。用真实
  // patched cli-debugger(eprintln转储active_sigscript, 见provenance)逐字节比对才发现——自检脚本
  // 00_self_check_generic_encoder.mjs此前"PASS"是假阳性: 它拿这份垃圾去跟同样被
  // `Buffer.from(encodeRegisterAppendAction(...))`包了一层的"专用编码器"比, 两边用同一种错误方式
  // 编码, 恰好互相吻合, 掩盖了问题——同账本1468"debugger自己合成见证掩盖bug"同一类"两边都错却互相
  // 印证"的教训, 只是这次错在我自己的审计工具而不是被测合约。修复: 返回hex字符串本身(不转Buffer),
  // 调用方需要原始字节时自己按需hexToBytes。
  return b.drain(); // hex string(无0x前缀), 不转Buffer
}

/** action ++ pushdata(redeem) — 同 debugger/cli/src/main.rs combine_action_and_redeem。
 * @param {string} actionHex encodeEntryActionGeneric的返回值(hex字符串, 无0x前缀) */
export function combineActionAndRedeem(kaspa, actionHex, redeemScriptBytes) {
  if (typeof actionHex !== 'string') throw new Error('combineActionAndRedeem: actionHex must be the hex string returned by encodeEntryActionGeneric, not a Buffer(ScriptBuilder.fromScript需要hex字符串, 见kaspa-wasm实测确认)');
  const b = kaspa.ScriptBuilder.fromScript(actionHex, { flags: { covenantsEnabled: true } });
  b.addData(hexToBytes(redeemScriptBytes));
  return Buffer.from(b.drain(), 'hex'); // 最终交付调用方(cli-debugger fixture/tx assembly)的是真实字节, 这里才转Buffer且用'hex'正确解码
}

/** 一步到位: entry witness + redeem 揭示 -> 完整 sigScript(Buffer, 真实字节)。 */
export function buildEntrySigScript(kaspa, entryAbi, argsByName, redeemScriptBytes) {
  const actionHex = encodeEntryActionGeneric(kaspa, entryAbi, argsByName);
  return combineActionAndRedeem(kaspa, actionHex, redeemScriptBytes);
}

export { hexToBytes };
