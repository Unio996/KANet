// generic-entry-witness-browser.mjs — 浏览器版通用 entry witness ABI 编码器(D-034 §8 后续票⑥,
// Bettor 派工 2026-09-27: 触发分账/退款交易需要在浏览器构造 covenant 的 sigScript, 不写新的编码
// 逻辑, 直接照搬 kasia-console/scripts/audit/generic-entry-witness.mjs 的编码规则——那份文件本身
// 逐字节对照 D-019 pin(3ed9733) silverscript-abi/src/lib.rs push_sig_arg(见该文件头注), 在 simnet
// 真实广播 split/refund/独立第三方 20/20 用例验证过。
//
// 唯一改动: Buffer → Uint8Array(浏览器没有 Node 的 Buffer 全局), 逻辑与字节序完全不变——
// vendor/generic-entry-witness-browser-parity.mjs 用大量随机向量对照原始 Buffer 版逐字节比对过,
// 不是"看起来像"的独立重写。
//
// 编码规则(与源文件同一段说明, 不重复推导):
//   int/temporal -> add_i64; bool -> add_i64(0/1); byte -> add_data([b]); bytes/text -> add_data(raw);
//   pubkey -> add_data(32B); sig -> add_data(65B); datasig -> add_data(64B); fixed_bytes{len} -> add_data(len B);
//   fixed_array/dynamic_array(非struct item) -> 拼接每个元素的encode_fixed_payload后整体一次 add_data。
//   全部param推完后, 最后加一次 add_data(dispatch_tag)。
//   combineActionAndRedeem: action ++ pushdata(redeem_bytes)。

function hexToBytes(h) {
  if (h instanceof Uint8Array) return h;
  if (Array.isArray(h)) return new Uint8Array(h);
  if (typeof h === 'string') {
    const s = h.startsWith('0x') ? h.slice(2) : h;
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }
  throw new Error(`hexToBytes: unsupported value ${JSON.stringify(h)}`);
}

function bytesToHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

function concatBytes(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// writeBigInt64LE 等价物 — 两者都是有符号 64 位小端, DataView.setBigInt64(offset, value, littleEndian)
// 与 Buffer.writeBigInt64LE 对同一 BigInt 输入产出逐字节相同的结果(两者都是标准两补码小端编码,
// 不存在"实现细节差异"这种东西——这是 IEEE 754/两补码整数编码的定义本身, 不是猜测)。
function writeBigInt64LE(value) {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigInt64(0, BigInt(value), true);
  return new Uint8Array(buf);
}

function encodeFixedPayload(ty, value) {
  switch (ty.kind) {
    case 'int': case 'temporal': return writeBigInt64LE(value);
    case 'bool': return new Uint8Array([value ? 1 : 0]);
    case 'byte': return new Uint8Array([Number(value)]);
    case 'pubkey': { const b = hexToBytes(value); if (b.length !== 32) throw new Error(`pubkey must be 32B, got ${b.length}`); return b; }
    case 'sig': { const b = hexToBytes(value); if (b.length !== 65) throw new Error(`sig must be 65B, got ${b.length}`); return b; }
    case 'datasig': { const b = hexToBytes(value); if (b.length !== 64) throw new Error(`datasig must be 64B, got ${b.length}`); return b; }
    case 'fixed_bytes': { const b = hexToBytes(value); if (b.length !== ty.len) throw new Error(`fixed_bytes(${ty.len}) got ${b.length}`); return b; }
    case 'fixed_array': {
      if (!Array.isArray(value) || value.length !== ty.len) throw new Error(`fixed_array len ${ty.len} mismatch`);
      return concatBytes(value.map((v) => encodeFixedPayload(ty.item, v)));
    }
    default: throw new Error(`encodeFixedPayload: unsupported nested type kind=${ty.kind}`);
  }
}

function encodeArrayPayload(ty, value) {
  if (!Array.isArray(value)) throw new Error(`encodeArrayPayload: value must be array for ${ty.kind}`);
  if (ty.kind === 'fixed_array' && value.length !== ty.len) throw new Error(`fixed_array expects len=${ty.len}, got ${value.length}`);
  return concatBytes(value.map((v) => encodeFixedPayload(ty.item, v)));
}

/**
 * @param {object} kaspa kaspa-wasm(注入)
 * @param {object} entryAbi compile(...)产物 contracts[Contract].entries[entryName](真实编译产物, 含 dispatch_tag + params[])
 * @param {object} argsByName { paramName: value, ... }
 * @returns {string} action hex(无 0x 前缀)——与 kaspa.ScriptBuilder.drain() 的返回值同型
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
      case 'byte': b.addData(new Uint8Array([Number(v)])); break;
      case 'bytes': b.addData(hexToBytes(v)); break;
      case 'text': b.addData(new TextEncoder().encode(String(v))); break;
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
  return b.drain(); // hex string(无 0x 前缀)
}

/** action ++ pushdata(redeem) — 同源文件 combineActionAndRedeem。
 * @param {string} actionHex encodeEntryActionGeneric 的返回值(hex 字符串)
 * @param {Uint8Array} redeemScriptBytes
 * @returns {Uint8Array} 完整 sigScript 字节
 */
export function combineActionAndRedeem(kaspa, actionHex, redeemScriptBytes) {
  if (typeof actionHex !== 'string') throw new Error('combineActionAndRedeem: actionHex must be the hex string returned by encodeEntryActionGeneric');
  const b = kaspa.ScriptBuilder.fromScript(actionHex, { flags: { covenantsEnabled: true } });
  b.addData(hexToBytes(redeemScriptBytes));
  return hexToBytes(b.drain());
}

export { hexToBytes, bytesToHex };
