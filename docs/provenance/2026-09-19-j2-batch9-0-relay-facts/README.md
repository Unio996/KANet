> **Status**: CURRENT（2026-09-19，J2；批9 9-0 落码回执证据；对应代码提交 `dbfa5599`，设计 v0.3.1 = `5bda9583`）

# 批9 9-0（relay 只读扩展 R1/R2）回执证据

**范围（Bettor 放行）**：设计清单第 1–8 项与第 10 项；第 9 项（simnet 对照）**已做**——见同级目录 `../2026-09-19-j2-batch9-0-facts-vs-node/`（17/17 通过；本文件写成时尚未做，后经 Bettor 放行补做）。D-021：本目录无真实地址/密钥/余额（测试用占位地址与 NWT 公开探针同款 simnet 脚本形状）。

## 文件即原始输出（不是摘要）

| 文件 | 内容 |
|---|---|
| `test-utxo-facts.txt` | `kasia-relay/src/lib/utxo-facts.test.mjs` 原始输出（33 项） |
| `test-proto-relay-ipc.txt` | `kasia-console/src/lib/proto-relay-ipc.test.mjs` 原始输出（既有 ①–⑥b 未改 + 新增 批9-0-a/b/b2/c/d + ⑦ 子进程） |
| `regress-*.txt` | 受波及的既有测试回归：proto-broadcast-ops / proto-leaf-state / proto-driver / covenant-broadcast-relay / covenant-broadcast |
| `lint-kanet.txt` | `node scripts/lint-kanet.mjs <本提交的 .js/.mjs 文件>`，0 errors；535 条 warning 全是既有的（R-DOC-STATUS 530、R-COMMAND-REGISTRATION 3 条既有 `chain_get_*` 半截注册——**没有新增第 4 个**、R-NET-DEFAULT-DRIFT `relay.mjs:13` 既有行、R-LEDGER-SIZE） |
| `mutation-utxo-facts.txt` | 对 `utxo-facts.mjs` 的 15 个变异（删哨兵 / 读顶层 covenantId / 面值升序 / 去 tiebreak / facts 真值判断 / 去回声 / 形态 O 带 truncated / 旧路径多字段 / 共享 rpc 失败回落旧路径 / pmt 校验拆掉 / observedAt 在读之前 / 截断先于过滤 / Number 比较 / 允许两形态并存 / 塞入 `new RpcClient`），**全部至少一条 FAIL**，末尾核对文件 sha256 已还原 |
| `mutation-registration.txt` | 对登记面与白名单的 7 个变异（authorize 漏登记 / commands 缺 FIELD_TYPES 或 PAYLOAD_SCHEMA / relay.mjs case 缺失 / 白名单多一项、标 write、删除），**全部变红**，四个文件 sha256 已还原 |
| `m0a-digest-check.txt` | `proto-relay-ipc.mjs` 的 `content_digest`：基线 `1ca46d7c…` 与当前 `21230389…` 各自与各自提交里的 manifest MATCH；`review_ref` 仍是上次批准的 `4c693999`（**待 NWT 审本 diff 后更新，我不编新号**） |
| `versions.txt` | node / npm / kaspa-wasm 版本与 `kaspa_bg.wasm` sha256、基线提交 |
| `mutate-*.mjs`、`m0a-digest-check.mjs` | 上述证据的产生脚本（变异脚本每次 finally 还原并核 sha256） |

复现（在 worktree 根）：`cd kasia-relay && node src/lib/utxo-facts.test.mjs`；`cd kasia-console && node src/lib/proto-relay-ipc.test.mjs`；变异 `node docs/provenance/2026-09-19-j2-batch9-0-relay-facts/mutate-registration.mjs <worktree 绝对路径>` 与在 `kasia-relay` 下 `node ../docs/provenance/.../mutate-utxo-facts.mjs <kasia-relay 绝对路径>`。

## 一次自己发现并修掉的测试盲点（留档，别当没发生）
第一版 `L5`（金额 >2^53 的排序）夹具的 txid 顺序恰好让"Number 比较退化为平局 → txid 升序"得出与 BigInt 相同的顺序，变异 M-m（改用 Number 比较）**存活**。已把夹具改成"较小面值配较小 txid"，M-m 现在被抓。教训：全绿一次过不等于测试有效，必须有变异对照。

## 诚实边界（这次证据证明了什么、没证明什么）
1. **夹具的真实性只到一半**：条目由真实 kaspa-wasm `UtxoEntryReference`（经 `Transaction` 输入的 `utxo` 字段反序列化）生成；但 `UtxoEntry` 构造器私有、`e.entry` 每次返回新克隆且 `IUtxoEntry` 入参没有 `covenantId`，所以 **covenant 条目 = 真实引用 + 把 `entry` 换成用真实 setter 设置了真实 `Hash` 的真实 `UtxoEntry`**（原型 getter、`in` 恒真、顶层 undefined 均与 NWT 探针一致）。这一层是合成的，**真实节点的字节一致性由第 9 项（simnet 逐字节对照）承担——已做，见 `../2026-09-19-j2-batch9-0-facts-vs-node/`**。
2. **真实 RPC 路径未跑**：`handleGetAddressUtxos` 的测试用注入的假 `rpc.getUtxosByAddresses`；真实 `RpcClient` 的行为（含 `waitForRpc` 真实超时）第 9 项已用真实 `RpcClient` 在 simnet 上验证了 `handleGetAddressUtxos` / `handleGetPastMedianTime` 函数本体（含数组入参 `getUtxosByAddresses([address])`）；**真实 relay 进程内的接线与 `waitForRpc` 真实超时**仍只由后续 9-4 覆盖。
3. **`FACTS_RPC_WAIT_MS = 8000` 是 J2 提议值**（默认 `waitForRpc` 30 s 大于 console 读命令 IPC 超时 15 s，console 会先超时），NWT 审 diff 时定。
4. **旧 relay 拒 R2、静默放行未知字段**这两条用的是**真实旧版** `6f6f9901:kasia-relay/src/lib/commands.mjs`（`git show` 取出后 import），不是我写的假验证器。
5. `M0a` 摘要门已用"故意写错摘要 → exit 1 且报出具体文件与摘要前缀 → 还原 → exit 0"验证是活的。

## 合入说明（Bettor 要求写明）
- **新命令 `get_past_median_time` 与 `get_address_utxos` 的 `facts` 形态需要 relay 重启才生效**（relay 是 console 拉起的子进程，运行中不会热加载）。**主网 relay 重启另走闸，不在 9-0 范围。**
- 合入本身**无运行时效果**：不带 `facts` 的既有调用字节不变；9-0 不发送 `facts`；无任何消费方（9-1 起才有）；不动 `p2sh.mjs` 与既有消费者；不动驱动开关；无迁移；无 env 变更。
- 改了 `proto-relay-ipc.mjs`（唯一受控出口）⇒ M0a manifest 的 `content_digest` 同提交更新；**`review_ref` 待 NWT 审后补**。
- 既知隐患不在本批：`deriveLeafOutpoint`/`deriveHeldKttOutpoint` 的 `landed_at DESC LIMIT 1` 无 tiebreak（Bettor 裁定留 9-1）。

## 唯一的脱敏
`test-proto-relay-ipc.txt`、`regress-proto-broadcast-ops.txt`、`regress-proto-driver.txt`、`regress-proto-leaf-state.txt` 首行/子进程行的 `[db] path=` 里本机 OS 账户名所在的临时目录前缀已替换为 `%TEMP%`（仓库公开，D-021）；除此之外所有 `.txt` 均为未改动的原始输出。
