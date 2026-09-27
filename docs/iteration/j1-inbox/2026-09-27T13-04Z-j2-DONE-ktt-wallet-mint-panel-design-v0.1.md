# J2 → Bettor · DONE：D-035 KTT 可钱包持有 + 铸币/查阅面板 · 设计稿 v0.1

**分支**: `coord/j2-ktt-wallet-panel-20260927`（独立 worktree `scratch/_j2_wt_ktt_panel`，基 `origin/bshard-m3-deploy@ea7f0ea2`，含 D-035 本身），commit `5e3751ad`，已推 origin。
**设计稿**: `docs/2026-09-27-j2-ktt-wallet-mint-panel-design-v0.1.md`

一口气写完六节，无跳步：

**①查现成**：`KanetTestToken.sil`（活）+ `KanetTokenClaim.sil`（活，`spend()` 硬编码
`owner_scheme:0x04`）+ `pool-bshard-artifacts.mjs:432 computeKttTokenArtifact`（活，
D-020 register_append 用的那份）+ `proto-covenant-builder.mjs:290
computeKttGenesisArtifact`（🔴 D-033 proto-v0 已冻结，只参照不 import，同名重复函数
不新增第三份，扩展活的那份）+ relay `p2sh.mjs:1958
unlockBshardGenesisMintStakeChip`（genesis-mint 广播先例）+ `covenant-broadcast.mjs`
安全闸 + `kcc20-token/*`（transfer witness 编码器、signing-key-binding 的"先反推应签
公钥再比对私钥"纪律模式）+ console `/tokens`（纯 DB 元数据，零链上语义，不能当铸币/
查阅面板本体）。

**②新合约**：新文件 `KanetTestTokenV2.sil`（老合约字节码不动，D-035 §3"老合约不动"
硬要求）。owner_scheme 新增 `0x00`——**直接复用上游 KCC-0020 `IDENTIFIER_PUBKEY`
命名**（`D:\silverscript\docs\kcc20-book\src\kcc20-contract.md`），不是现编数字；
`checkSig(sig, pubkey(owner))` 花费，`sig[]`/`sig` 平行参数照抄上游 `checkSigs` 形状
（`DECL.md:59` 证实 `sig[]` 是合法声明参数类型）；同笔 tx 内 covenant-owned 与
pubkey-owned 可混用。对 D-020/ShardLeaf 零影响的论证：老合约铸币函数
`computeKttTokenArtifact` 的 `owner_scheme` 硬编码不动，新老两族 template_hash 天然
不同，市场合约只认自己烤的老 hash。ECDSA 列为待定（33 字节公钥装不进现有 32 字节
owner 字段，需要 P2PKH 式改法，v1 不做）。

**③铸币**：照抄 `unlockBshardGenesisMintStakeChip` 骨架（含它已踩过的
`populateGenesisCovenants` 坑，2026-09-26 real-simnet 排障记录）+
`covenant-broadcast.mjs` 安全闸。手续费从铸币资金输入里扣（同 Owner 原话"最多花一些
转账gas"），公共水龙头（免 KAS 铸币）列为独立待设计问题，不在本稿展开。

**④查阅面板**：结构性论证"地址由 (模板,owner,amount) 决定"——不同 amount 落在不同
P2SH 地址，没有"owner→全部持仓"的反查表存在。三层不依赖索引器的发现方式：①自己的
铸币/转账回执（可靠）②本地记录表 `ktt_holdings_ledger`（持久化①）③逐笔用已知地址
问节点核实是否已花费（可靠但只能核"已知地址"）。**诚实写明局限**：给定任意一个从未
交互过的地址，列出其全部 KTT——在不建真 covenant-aware UTXO 索引器前提下做不到，
面板 UI 措辞必须避免暗示"完整性"。三个待定项（地址输入格式/DB 挂载/URL 前缀）默认
值已给。

**⑤组件接入**：只写接口与影响面，不实现。核心点：KTT 模式下付款人的 KTT 必须是
pubkey-owned（②）才能从自己钱包发起——这是②③④与⑤唯一的依赖关系，没有②，⑤的
"消费者用自己钱包 KTT 付款"无法表达。列出若要做需要新增/改动的文件清单（新合约
`CommissionSplitKtt.sil`、SDK 姊妹函数、checkout-static 姊妹角色解析），零影响下注
市场合约族。

**⑥对抗清单**：伪造owner/无签名花费/守恒绕过/新旧方案混用/铸币抢跑五项 + 本稿自己
新增机制引出的补充项（owner=0 在 checkSig 分支下是否重现老合约的裸花漏洞——推理是
"不重现"，但标注 NWT 审时需要真实向量核实，不能只凭密码学直觉）。

交 NWT。停在这里等结果。
