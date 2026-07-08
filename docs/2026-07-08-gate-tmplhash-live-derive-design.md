# gateTmplHash 硬编码常量根治 — live-derive + round-trip 自证设计稿(半页)

> **Status**: CURRENT
> **作者**: J1tn 2026-07-08 · **上游依据**: Bettor 门②裁定 #cbjvjq(pxvml genesis 出生缺陷根修条款③) · **验收锚**: 5R-2 重开前必须落地

## §0 一句话

**`ZK_GATE.gateTmplHash`(zk-close-builder.mjs:34)是跟 `imageId` 手动配对维护的硬编码常量——7/7 imageId 从 335cae6c 修正到 c9918501(commit #afw8pg)时,紧挨着的 gateTmplHash 没有同步重算,潜伏了一天多没人发现,直到今晚门②(zk_close pre-broadcast debugger)拦下 pxvml 才暴露。跟 `computeCloseZkTmplAnchor` 已有的"round-trip 自证"同一个病根("硬编码常量 vs 实际编译产物脱节"),吃同一副药: 把这个值从人肉维护的常量改成程序化计算+自证,而不是继续手动配对两个数字。**

## §1 根因(已用 git log + Bettor 链上重建交叉验证,非猜测)

- `imageId`/`gateTmplHash` 是**两个独立烤在源码里的常量**,理论上必须严格配对(gateTmplHash 是"对这个 imageId 对应的 guest 电路,gate 结构该长什么样"的密码学承诺),但代码里**没有任何机制强制或校验这个配对关系**。
- 7/7 修 imageId 时(commit 附近的 #afw8pg),只改了 `imageId` 那一行,`gateTmplHash` 原样留着——这是纯人工操作失误,没有工具/自动化能在那次修改时喊停。
- 潜伏期内新 mint 的市场(pxvml 等)都把这个错误配对烤进了 genesis,create 阶段完全不会报错(gateTmplHash 只在 zk_close 真正验证时才会被 covenant 拿出来比对),等于是一颗**定时炸弹要到结算阶段才炸**——跟今晚反复出现的"stale 值不炸在写入点、炸在很晚的下游"同一个形状。

## §2 方案:计算 + 自证,不再手动配对

### §2.1 计算侧:gateTmplHash 从 imageId 程序化推导,不再单独烤一个数字

`gate_tmpl_hash = blake2b(prefix ‖ suffix)`,其中 `prefix`(1B, 固定 0x20)/`suffix`(800B, 固定-per-image_id)来自 zk-sdk 的
`ZkScriptBuilder.newR0().commitToGroth16WithFixedJournal(imageId, <任意合法 journalHash>).finalizeWithGroth16FixedJournalProof(<任意该 imageId 的合法 receipt>)`
的 `redeemScript`(去掉 prefix+journalHash 剩下的 suffix 部分——跟 `rebuildZkCloseGateWitness` 已经在用的同一条切法,不新开一套)。

**关键洞察**: `suffix` 只依赖 `imageId`,不依赖具体 `journalHash`/`receipt` 的内容(这也是"fixed-per-image_id"这句注释的字面意思)——所以任何一份该 imageId 的合法 receipt(哪怕是旧的、别的市场用过的)都能用来推出同一个 `gateTmplHash`,不需要为每个新市场单独跑一次真实 proving。**已双锚经验证实(NWT 审确认不需要再验)**: Bettor 用两份完全不同的 receipt/journalHash(pxvml 的 journalHash 3d320acb + 7/7 3o6cs 那笔)、同一个 imageId,各自独立推出同一个 4ec7ca3d——不是单一样本巧合。

新函数 `computeGateTmplHash(imageId, sampleReceiptHex, sampleJournalHash, kaspaZk)`(建议放 `zk-close-builder.mjs` 或独立 `gate-tmpl-hash.mjs`,单一权威计算点,`rebuildZkCloseGateWitness`/mint 流程都调它,不各自维护一份):
```js
export function computeGateTmplHash(imageId, sampleReceiptHex, sampleJournalHash, kaspaZk) {
  const kaspa = kaspaZk();
  const builder = kaspa.ZkScriptBuilder.newR0({ flags: { covenantsEnabled: true } });
  builder.commitToGroth16WithFixedJournal(imageId, sampleJournalHash);
  const { redeemScript } = builder.finalizeWithGroth16FixedJournalProof(sampleReceiptHex);
  const redeemBuf = Buffer.from(redeemScript, 'hex');
  const suffix = redeemBuf.subarray(33);           // 同 rebuildZkCloseGateWitness 既有切法, 不新开一套
  return require('blake2b')(Buffer.concat([Buffer.from([0x20]), suffix]), { dkLen: 32 }).toString('hex');
}
```
`sampleReceiptHex`/`sampleJournalHash` 来源:今晚已有 7/7 落链的真实 receipt(3o6cs 那笔, `zk-payout-guest/proofs/3o6cs-attest-0a358fa0/`)可以固定当"canonical sample",不需要每次现跑一次 proving。

### §2.2 自证侧:round-trip 校验,跟 computeCloseZkTmplAnchor 同一副药

🔴 **STOP 修正(Bettor 注3 + NWT 审必须折入, 非可选建议)**: 不能在 console 进程启动那一刻无条件跑这段检查——ZKSDK_WASM_PATH 指向的隔离 WASM build 不是所有 console 实例都装了/都打算用(非 ZK 节点), 无条件启动时跑会让这些实例因为一个跟它们无关的新增强校验直接炸掉整个进程启动, 是"根治一个 drift 风险却引入一个更大的可用性风险"(#22 族教训)。改成 **lazy, gate 在既有的 `ZK_PROVE_WORKER_ENABLED` 开关后面**(zk-prove-worker.mjs:116/120 已有生产开关, 默认 OFF, 复用不新开一个):

```js
let _zkGateVerified = false;
function _ensureGateTmplHashFresh() {
  if (_zkGateVerified || process.env.ZK_PROVE_WORKER_ENABLED !== '1') return;   // 非 ZK 节点直接跳过, 零影响
  const computed = computeGateTmplHash(ZK_GATE.imageId, CANONICAL_SAMPLE_RECEIPT_HEX, CANONICAL_SAMPLE_JOURNAL_HASH, kaspaZk);
  if (ZK_GATE.gateTmplHash !== computed) {
    throw new Error(`gateTmplHash 配置漂移: 烤死值=${ZK_GATE.gateTmplHash} != 现算=${computed}(imageId=${ZK_GATE.imageId})——常量已过期或 imageId 刚变过, fail-loud 不静默沿用可能错的值`);
  }
  _zkGateVerified = true;
}
// 调用点: zkProveWorkerTick() 首次真正跑 proving 之前 / rebuildZkCloseGateWitness 首次被调用之前(两个 ZK 功能
//   真正被使用的入口, 而非"进程启动"这个跟是否使用 ZK 无关的时间点)。
```
**效果**: 只要 `imageId` 换了(guest 重编译)、`gateTmplHash` 却没人手动跟着改,**下次真正要用到 ZK 功能时**直接拒绝(fail-loud),不会再出现"配对关系悄悄脱节、潜伏一天多才在结算阶段炸"这种情况——同时不给任何不使用 ZK 功能的 console 实例增加新的启动失败风险面。

## §3 范围边界

- **不改** `imageId` 本身的来源/固定方式(guest 电路换版本时,imageId 换了本来就该是个显式、审慎的动作,不是这次要根治的东西)。
- **不要求**每次 mint/propose 都重新调用一次 proving(§2.1 已说明 suffix 只依赖 imageId, 复用固定 sample receipt 即可,零额外 proving 成本)。
- **不动** `rebuildZkCloseGateWitness`(门②/真广播共用的 witness 重建函数)本身——它已经是对的,这次根治的是"gateTmplHash 这个比对基准本身可能是错的"这一层,不是 witness 重建逻辑。

## §4 落地清单

1. `computeGateTmplHash` 函数落码(zk-close-builder.mjs 或独立文件)。
2. 固定一份 canonical sample receipt/journalHash(7/7 3o6cs 那笔,写死引用路径,不是每次现找)。
3. `ZK_GATE` 常量改成程序化计算+lazy round-trip 校验(§2.2, gate 在 ZK_PROVE_WORKER_ENABLED 后面, env drift 直接 throw)。
4. pxvml 当前烤错值的 genesis 无法挽回(§0 已定案 STOP,走 escape 退款),这条只防未来新 mint 的市场再犯。
5. **清除全部同族 stale fallback(Bettor 注2, 一次性扫清不留残留)**: `pool.js:127`(511b0ead 硬编码 fallback)、`pool.js:128` 与 `bshard-close-transport.mjs:454` 的 `_j2_closezk_repro4.sil` 默认路径(Repro4 永久禁铸令的残留代码路径)——统一改成"无 env 即 throw"或直接用 §2.1 的计算值,不留任何会静默兜底的过期常量。
6. NWT 审此设计,J2/我按分工落码(具体 owner 待 Bettor 派工确认)。

## §5 签字区

- J1tn(设计): ✅ 2026-07-08
- 待: NWT 审、Bettor 派工/GO
