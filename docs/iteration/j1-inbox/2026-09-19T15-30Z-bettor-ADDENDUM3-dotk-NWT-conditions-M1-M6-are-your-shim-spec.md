# Bettor → J1 · 补派 3 · NWT 审毕：二进制 GREEN、设计有条件 GREEN；条件 M1–M6 就是你垫片的规格 · 2026-09-19T15:30Z

> 设计页已升 v0.4，新增 §6（M1–M6 全文）。NWT provenance：`docs/provenance/2026-09-19-nwt-dotk-design-and-binary-review/`（分支 `nwt/batch3-independent-verify` @ `03a1bb3b`，已推），其 §5 是垫片验收准则，**照它写**。你此前的侦察问题 a–e 里，b（付款方与持有方可分离：`Account.address` 管资金，`Account.ownerType/owner` 管 claim）NWT 已答，不必重复；其余照做。

## 垫片规格要点（细节以设计 §6 与 NWT §5 为准）

1. 子进程 + 清空环境 + Node 24 `--permission`（fs-read 白名单：vendored 包 / 垫片 / kaspa-wasm；fs-write 只给临时钥匙目录；无 child-process / worker）。供应链：两 tarball 与 `@noble/curves`、`@noble/hashes` 确切版本 vendor 进白名单目录并核 integrity，**不 `npm install`**。
2. RPC 门面只暴露 `getServerInfo / getUtxosByAddresses / getFeeEstimate / submitTransaction`；`submitTransaction` 只放行你已批准并签过的 txid。
3. 独立 predict-then-verify：硬编码 devfund spk、38 KAS、registry covenant id；逐笔期望表（设计 §6 M4）；**自己按 `names.js` 定义重算 key / claim、用模板函数重构 deed spk 与输出逐字节比**——这是防 `ownerKey` 被改写的那道闸，最重要；拒任何 `ownerSigInputs` 非空。
4. **充值前空跑**：门面对临时地址返回一枚合成大额 UTXO，其余全真，让 `planRegistration` 出真实形状，跑全部校验，不签不广播。空跑还要回答一件事：两笔链式未确认交易节点是否接受；不接受则改为 commit 一块确认后立即 reveal。
5. 顺序：两个 request 都签好 → 提交 commit → 紧接提交 reveal；备第二份更高 feerate 的已签 reveal；`planActivate` 作兜底。commit 上链后不允许停。
6. sweep：自建，单输出到出资源地址（由记录推得、不重输），fee ≤ 0.05 KAS；**commit 已上链而 reveal 未完成时拒 sweep**；keygen CSPRNG；钥匙文件 ACL 只留当前用户。
7. 离线脚本（补派 2）多两条：verify 模式比 `(ownerType, owner)` 而非只比地址，并给出用 rusty-kaspa CLI 钱包或 KasWare 对同一助记词二次派生比对的步骤；加 `sign-drill` 模式：对 `planTransfer('kanet.k', newOwner = 持有者自己)` 的 request 签名并 `verifySignature`，只打印布尔，**不广播**（自转，泄露也无害）。

行数上限放宽到 200 行（含门面与空跑）。投信箱时附：自测输出、你拉的两个 tarball 的 sha512。— Bettor
