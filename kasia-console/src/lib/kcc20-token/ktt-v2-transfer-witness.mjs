// ktt-v2-transfer-witness.mjs — KanetTestTokenV2.transfer/transfer_delegator 真实 v1.0.0 sigScript 编码
// (D-035 §2 实现, J2 2026-09-27)。逐字对照 kcc20-token/ktt-transfer-witness.mjs(v1 版同名场景的既有
// 编码器)——v2 唯一的形状差异是 `transfer` 多了一个 `sigs: sig[]` 末位参数(平行于 owner_input_idx),
// `transfer_delegator` 多了一个 `my_sig: sig` 末位参数(单个, 非数组)。
//
// 🔴 为什么不用 kasia-console/scripts/audit/generic-entry-witness.mjs 的通用编码器(commission-plan-sdk.mjs
// 已在用它): 亲测过(kanet-tn12 scratch 实测)——它的 `dynamic_array` 分支对 struct 元素类型(next_states:
// State[])不做 SoA 转置(silverscript-abi push_struct_array_fields 的真实行为, 按 struct 每个字段转置成
// 一个新数组分别 push), 只是把数组整体当"元素扁平拼接"处理, 对 `next_states=[]`(0元素)会产出 1 次 OP_0,
// 而真实编码需要"State 有几个字段就几次 OP_0"(每个字段各自的转置数组都是空数组)——本模块延续 v1 版的
// 判断, 仍手写这部分, 其余(witness/owner_input_idx/sigs 这些非 struct 平铺类型)的编码规则与通用编码器
// 完全一致, 因为它们本就走 push_fixed_bytes/encode_array_payload 的标量路径, 不受这条限制影响。
//
// 决定性验证: docs/provenance/2026-09-27-j2-ktt-v2-adversarial-*/ 下的真实 simnet 广播(有 txid)。

function hexToBytes(h) {
  if (Buffer.isBuffer(h)) return h;
  if (Array.isArray(h)) return Buffer.from(h);
  return Buffer.from(h.startsWith('0x') ? h.slice(2) : h, 'hex');
}

/**
 * @param {object} kaspa
 * @param {object} entryAbi compileSilV100(...)._raw.contracts.KanetTestTokenV2.entries.transfer
 * @param {number} stateFieldCount compileSilV100(...)._raw.contracts.KanetTestTokenV2.runtime_state.fields.length
 * @param {number[]} ownerInputIdx 单个元素数组(leader-of-one 场景), 如 [3]
 * @param {string[]} sigsHex 65 字节 hex 签名数组, 与 ownerInputIdx 平行(同下标对应同一个 prev_state)。
 *   covenant-owned(owner_scheme=0x04)的下标可传任意 65 字节占位值(合约不读它, 见 KanetTestTokenV2.sil
 *   transferPolicy: 只有 owner_scheme==SCHEME_PUBKEY 分支才 checkSig(sigs[i], ...))。
 */
export function encodeKttV2TransferZeroOutAction(kaspa, entryAbi, stateFieldCount, ownerInputIdx, sigsHex) {
  if (!entryAbi?.dispatch_tag) throw new Error('encodeKttV2TransferZeroOutAction: entryAbi.dispatch_tag missing');
  if (!(Number.isInteger(stateFieldCount) && stateFieldCount > 0)) {
    throw new Error('encodeKttV2TransferZeroOutAction: stateFieldCount must be a positive integer(真实编译产物的 runtime_state.fields.length?)');
  }
  if (!Array.isArray(ownerInputIdx) || !ownerInputIdx.length) throw new Error('encodeKttV2TransferZeroOutAction: ownerInputIdx must be a non-empty array');
  if (!Array.isArray(sigsHex) || sigsHex.length !== ownerInputIdx.length) throw new Error(`encodeKttV2TransferZeroOutAction: sigsHex.length(${sigsHex?.length}) must equal ownerInputIdx.length(${ownerInputIdx.length})`);

  const b = new kaspa.ScriptBuilder({ flags: { covenantsEnabled: true } });
  // next_states=[](0元素): 每个 State 字段的转置数组都是空数组 -> 每个字段一个空 push(OP_0)。同 v1。
  for (let i = 0; i < stateFieldCount; i++) b.addData(new Uint8Array(0));
  // witness=[](空 bytes)
  b.addData(new Uint8Array(0));
  // owner_input_idx: int[] -> 拼接每个元素的 8 字节小端, 整体当一个 push。
  const idxBuf = Buffer.alloc(ownerInputIdx.length * 8);
  ownerInputIdx.forEach((v, i) => idxBuf.writeBigInt64LE(BigInt(v), i * 8));
  b.addData(idxBuf);
  // sigs: sig[] -> 拼接每个元素的 65 字节原始签名, 整体当一个 push(silverscript-abi push_sig_arg:
  // TypeArtifact::Sig => push_fixed_bytes(...,65); DynamicArray<Sig> 走 encode_array_payload,
  // 每元素定长 65B 直接拼接, 无长度前缀, 真实源码 D:\silverscript-v100\silverscript-abi\src\lib.rs:1099)。
  const sigBufs = sigsHex.map((s) => {
    const buf = hexToBytes(s);
    if (buf.length !== 65) throw new Error(`encodeKttV2TransferZeroOutAction: each sig must be 65 bytes, got ${buf.length}`);
    return buf;
  });
  b.addData(Buffer.concat(sigBufs));
  b.addData(hexToBytes(entryAbi.dispatch_tag));
  return b.drain();
}

/**
 * transfer_delegator(byte[] witness, int my_owner_input_idx, sig my_sig) — 非 leader 输入各自独立编码。
 * @param {string} sigHex 65 字节 hex 签名(covenant-owned 分支可传任意 65 字节占位值)。
 */
export function encodeKttV2TransferDelegatorAction(kaspa, entryAbi, myOwnerInputIdx, sigHex) {
  if (!entryAbi?.dispatch_tag) throw new Error('encodeKttV2TransferDelegatorAction: entryAbi.dispatch_tag missing');
  const sigBuf = hexToBytes(sigHex);
  if (sigBuf.length !== 65) throw new Error(`encodeKttV2TransferDelegatorAction: sig must be 65 bytes, got ${sigBuf.length}`);
  const b = new kaspa.ScriptBuilder({ flags: { covenantsEnabled: true } });
  b.addData(new Uint8Array(0));   // witness=[]
  const idxBuf = Buffer.alloc(8);
  idxBuf.writeBigInt64LE(BigInt(myOwnerInputIdx), 0);
  b.addData(idxBuf);
  b.addData(sigBuf);
  b.addData(hexToBytes(entryAbi.dispatch_tag));
  return b.drain();
}

/**
 * 通用版: next_states 可以非空(SoA 转置, 真实 silverscript-abi push_struct_array_fields 行为——按
 * struct 每个字段转置成"这个字段在所有元素上的值"组成一个新数组分别 push, 不是逐元素整体 push)。
 * next_states.length==0 时退化成上面 ZeroOut 版本的等价行为(每个字段仍各推一次空 push)。
 * @param {{amount:bigint|number, ownerHex:string(32B hex), ownerScheme:number, borrowScheme:number,
 *   borrowGuardHex:string(32B hex), extensionCommitmentHex:string(32B hex)}[]} nextStates
 */
export function encodeKttV2TransferAction(kaspa, entryAbi, stateFieldOrder, nextStates, ownerInputIdx, sigsHex) {
  if (!entryAbi?.dispatch_tag) throw new Error('encodeKttV2TransferAction: entryAbi.dispatch_tag missing');
  if (!Array.isArray(stateFieldOrder) || !stateFieldOrder.length) throw new Error('encodeKttV2TransferAction: stateFieldOrder must be the real compiled runtime_state.fields array(name+type), not a hardcoded count');
  if (!Array.isArray(sigsHex) || sigsHex.length !== ownerInputIdx.length) throw new Error(`encodeKttV2TransferAction: sigsHex.length(${sigsHex?.length}) must equal ownerInputIdx.length(${ownerInputIdx.length})`);

  const FIELD_KEY = { amount: 'amount', owner: 'ownerHex', owner_scheme: 'ownerScheme', borrow_scheme: 'borrowScheme', borrow_guard: 'borrowGuardHex', extension_commitment: 'extensionCommitmentHex' };
  const b = new kaspa.ScriptBuilder({ flags: { covenantsEnabled: true } });
  for (const f of stateFieldOrder) {
    const key = FIELD_KEY[f.name];
    if (!key) throw new Error(`encodeKttV2TransferAction: unknown State field '${f.name}' in real compiled ABI(schema drift?)`);
    const parts = nextStates.map((s) => {
      const v = s[key];
      if (f.type.kind === 'int') { const buf = Buffer.alloc(8); buf.writeBigInt64LE(BigInt(v)); return buf; }
      if (f.type.kind === 'byte') return Buffer.from([Number(v)]);
      if (f.type.kind === 'fixed_bytes') { const buf = hexToBytes(v); if (buf.length !== f.type.len) throw new Error(`${f.name}: expected ${f.type.len}B, got ${buf.length}`); return buf; }
      throw new Error(`encodeKttV2TransferAction: unsupported State field type kind '${f.type.kind}' for ${f.name}`);
    });
    b.addData(Buffer.concat(parts));
  }
  b.addData(new Uint8Array(0));   // witness=[]
  const idxBuf = Buffer.alloc(ownerInputIdx.length * 8);
  ownerInputIdx.forEach((v, i) => idxBuf.writeBigInt64LE(BigInt(v), i * 8));
  b.addData(idxBuf);
  const sigBufs = sigsHex.map((s) => { const buf = hexToBytes(s); if (buf.length !== 65) throw new Error(`encodeKttV2TransferAction: each sig must be 65 bytes, got ${buf.length}`); return buf; });
  b.addData(Buffer.concat(sigBufs));
  b.addData(hexToBytes(entryAbi.dispatch_tag));
  return b.drain();
}

/** action ++ pushdata(redeem) — 同 proto-register-append-witness.mjs 的 combineActionAndRedeem 逻辑。 */
export function combineKttV2ActionAndRedeem(kaspa, actionHex, redeemScriptBytes) {
  const b = kaspa.ScriptBuilder.fromScript(actionHex, { flags: { covenantsEnabled: true } });
  b.addData(hexToBytes(redeemScriptBytes));
  return b.drain();
}
