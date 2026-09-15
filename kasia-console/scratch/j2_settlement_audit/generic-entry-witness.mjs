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
  return Buffer.from(b.drain());
}

/** action ++ pushdata(redeem) — 同 debugger/cli/src/main.rs combine_action_and_redeem。 */
export function combineActionAndRedeem(kaspa, actionBytes, redeemScriptBytes) {
  const b = kaspa.ScriptBuilder.fromScript(Buffer.isBuffer(actionBytes) ? actionBytes : hexToBytes(actionBytes), { flags: { covenantsEnabled: true } });
  b.addData(hexToBytes(redeemScriptBytes));
  return Buffer.from(b.drain());
}

/** 一步到位: entry witness + redeem 揭示 -> 完整 sigScript(Buffer)。 */
export function buildEntrySigScript(kaspa, entryAbi, argsByName, redeemScriptBytes) {
  const action = encodeEntryActionGeneric(kaspa, entryAbi, argsByName);
  return combineActionAndRedeem(kaspa, action, redeemScriptBytes);
}

export { hexToBytes };
