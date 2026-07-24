# J2 Codex MSG-124 整改(A+B+C+D+真相校正) 待审 diff（2026-07-24）

跨节点传递用临时文件，审完随本次 manifest 更新一起删除。**⚠ 密钥经手场景，且改动了 crypto.js（加密核心，reviewed encrypt/decrypt）——务必格外仔细审 crypto.js 那部分是纯新增不动原有函数。**

## 变更文件

1. `kasia-console/src/services/crypto.js` — **纯新增**导出 `currentKeyFingerprint()`，`encrypt()`/`decrypt()` 原有函数一行未动。digest=`50456136560d0c79b531ab9ea5af4f84977638a39faa413a1502bf3fe89feca0`
2. `kasia-console/src/index.js` — 启动时打印 CONSOLE_ENCRYPTION_KEY 指纹（C 整改）。digest=`2d1cebf6fb168a640f751f4236cac99fe2e40bab53b41256e5cab827953d0267`
3. `kasia-console/scripts/m0c1-pilot-candidate-generate.mjs`（新文件）— A+B 整改核心：offline 候选生成器。digest=`8a20b7deec9d4dc6ec9187fb018fb53726ad96b6031ab181964fbc3779287df9`（不触发 M0a 门，不 import better-sqlite3/relay-manager）
4. `kasia-console/scripts/m0c1-pilot-custodial-insert.mjs` — 全面重写：改用 candidate-file（取代 stdin）+ --db 硬 required（C）+ db.transaction() 包 INSERT+readback（D）+ shred 三档时机规则。digest=`c1be4e273fb384007707ff4389e606fe8416929e0d92d030b27e3dc28a72101e`
5. `kasia-console/test-framework/cases/m0c1-gate/pilot-custodial-insert-regression.mjs` — 全面重写适配新流程 + 真并发原子性测试。digest=`fdddc36992ea5c79de48d08a42857fa130aa5e9fd5652bd67e812c44694ec2a0`
6. `kasia-console/test-framework/cases/m0c1-gate/provision-payee-regression.mjs` — 补 source_commit/blob 自描述字段（真相校正）。digest=`c9d085c99a16d0dc8e6bed02acacadb687e428364c1d6b2f83383472f95b063d`

## 背景

`docs/2026-07-24-m0c1-pilot-codex-msg124-rectification.md` Codex 终审 5 条 MUST-FIX 中的 A/B/C/D + 真相校正，认领方案见 `scratch/j2-msg124-rectification-design.txt`（三人红队 GREEN 批落码）。

## A+B（合并方案）

根因：`readline({terminal:false})` 不禁终端 echo，人在真终端敲 mnemonic 会显示+被录屏留——上一轮"stdin 不回显"是 over-claim。修法：不试图隐藏终端输入，而是彻底不给"交互式终端打字喂入明文 mnemonic"这个选项。

- `m0c1-pilot-candidate-generate.mjs`（新，§3 offline 候选阶段）：生成 mnemonic → 派生地址 → **同一 tick** 加密落盘（`scratch/pilot-candidate-<label>-<ts>.enc.json`，含 `mnemonic_encrypted`/`address`/`network`/`key_fingerprint`）。stdout 只打印 address（供 Owner 审批）+ 候选文件路径 + key 指纹，从不打印/log mnemonic 明文。
- `revoke` 子命令：no-go/abort 路径单纯 shred 候选文件，不碰 DB。
- `m0c1-pilot-custodial-insert.mjs`：`--candidate-file` 取代 stdin。读文件 → 候选 address 字段先比对一次 → decrypt → 重新派生地址交叉验证（双重防线，防候选文件被篡改成"address 字段对但 mnemonic 不对"）。

## C（helper 半）

- `--db` 无默认值，硬 required；若指向不存在的文件直接拒绝（不静默新建——canonical DB 应该已经存在，路径打错比新建更可能是真相）。
- `crypto.js` 新增 `currentKeyFingerprint()`（sha256(key) 前 8 hex，不可逆推），helper 启动打印；`index.js` 启动也打印同一函数——两处调同一个 reviewed 函数，避免指纹算法本身在两处实现漂移（密钥链一致性）。
- 候选文件里也存了生成时的 key 指纹，insert 时若跟当前 key 指纹不一致，提早报错（诊断，非安全边界——真安全边界是下面的 AES-GCM auth tag 校验）。
- helper 文件头 + stdout 末尾明确诚实标注：自身验证只证内部一致性，不证明 live Console 能用同一 DB/key 读到这行——权威证明留给 runbook §4.5 live 转账（KANet-UI 负责的 runbook 半）。

## D

`INSERT` + 同事务内 `SELECT+decrypt+derive+比对` 包进同一个 `db.transaction()`——事务内 `throw` 触发 better-sqlite3 自动 ROLLBACK，取代原来 INSERT→SELECT→条件 DELETE 三条独立语句之间的 crash 残留窗口。

**shred 三档时机（NWT 红队钉死）**：① 事务 commit 成功后 ② genuine mismatch（候选内容本身跟批准值对不上/readback 真失败）③ 显式 revoke。**绝不**在 transient infra 失败（DB locked/key 不一致/tg_user_id 重复/network typo）时 shred——这些场景候选文件本身没坏，允许 operator 换个正确参数重试同一候选。

## 真相校正

`provision-payee-regression.mjs` 补 `source_commit`/`test_blob_sha`/`target_blob_sha` 三字段，逻辑照抄 G4 harness 已验证过的那段（`execFileSync git rev-parse/hash-object`，best-effort）。`pilot-custodial-insert-regression.mjs` 同款补齐。

## 真对抗测试（真实调用两个 CLI，spawnSync/execFileSync，非 mock）

33/33 PASS，覆盖：①候选匹配正常流程②候选文件被篡改 abort 不写库+shred③占位符拒绝, 候选不 shred④重复拒绝, 候选不 shred⑤network typo 白名单拒绝⑥`--db` 缺失/指向不存在文件两种场景都拒绝⑦候选与 insert 用不同 key → key 指纹不一致拒绝, 候选不 shred⑧**真并发**（`Promise.all`，非顺序 await）两个进程抢同一 `tg_user_id`——恰好 1 个成功，DB 里恰好 1 行（证明输家的 INSERT 从未提交，非"插入又清理"，两者对 crash-window 防护等级不同）⑨非法 mnemonic 错误路径 no-leak（逐词扫描）+候选 shred。

既有回归 26/2 零新增 + G4 27/27 零回归 + provision-payee-regression 13/13 零回归 + lint 0 errors（6 文件一起过 M0a 门，正确检出旧 digest 失配）。

## 请求
NWT 独立核实（密钥经手+加密核心改动，格外仔细）：① 6 个 digest 全部一致；② crypto.js 确认是纯新增（`encrypt`/`decrypt` 一字未改）；③ shred 三档时机规则真落码（尤其 transient vs genuine mismatch 的判据区分：`READBACK_MISMATCH:` 前缀 vs 其他异常）；④ D 的 `db.transaction()` 真包住 INSERT+readback；⑤ 真并发测试(⑧)真实可复现；⑥ 给 `review_ref`。
