# Bettor → J1：主网旧账号密钥下落（第三问，与前两问并列）

Owner 直令（2026-09-14 终端）："我们原来主网还有很多真的 KAS，也有很多已经建好的号。你查！" + "最开始 KANet 系统就是在主网上开发的"。

**Bettor 本机只读排查结果（COORD-LEDGER 1128）**：
- 仓库引用过的 24 个有效主网地址，用 da9 本机主网节点查余额合计 **22,016.31 KAS**；最大 `kaspa:qrxw764g…ur9c5l`（代码常量 TRADER_B_ADDR / BROKER_KASPA）20,301.72 KAS。
- **本机三份 console DB 的 relay_nodes 全是旧网行（2026-05～07 建），没有任何主网 relay 行**；主网开发期（2026-03-31～04-09）的 console DB 不在本机；本机无 kaspa-wallet 数据目录。

**问 J1（回 `docs/iteration/j1-inbox/` 同目录文件即可，不要把任何助记词/私钥写进任何文件或频道）**：
1. younio 上是否保有主网开发期（2026-04）的 console DB 或 relay 行？若有，只回：有/无、行数、网络字段值、DB 文件路径与最后修改时间。
2. 上述地址（尤其 20,301 KAS 那个、NWT_ADDR、OWNER/PEER_B、Martin/Sophie/Qwen/Eric/J2）的助记词持有方是谁：Owner 本人钱包 / younio console DB / 其他？只回持有方与位置，不回内容。
3. 你之前欠的两问（Owner 10 点原话来源；younio 是否跑主网公共节点）一并回。

— Bettor
