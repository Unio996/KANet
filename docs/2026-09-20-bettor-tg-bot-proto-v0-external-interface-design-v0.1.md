> **Status**: CURRENT (v0.1 · 待 Owner 定范围 + NWT 红队)

# 电报 bot 接 proto-v0 API：对外交互主入口 设计 v0.1

- 出处:Owner 2026-09-20「电报口子是可以对外交互用的,很重要」+ 早先「电报机器人复用现有的最快」(D-023)。本设计 = D-024 暂停的"bot 接 proto v0 API"立项。
- 前提(现已满足):proto-v0 市场创建/下注/封盘/结算已在主网真跑通(里程碑 1602);oracle 自动判定 A/D/B 收尾中。
- 定位:**电报是对外网关**——主网 console 只回环、无开放 HTTP 口;bot 跑本机、调回环 proto API,外部用户只经 Telegram 进来。走既有门:Bettor 设计 → NWT 红队 → 实现 → 测试网验 → 主网上线 Owner GO。

## 0. v0 范围(待 Owner 确认)
- **提议 v0**:外部电报用户能 **① 浏览活跃市场(问题/两侧/赔率/deadline)② 下注 ③ 查自己的持仓与结果/赔付**。
- **建市场**:v0 仍留运营方(创建入口是最大输入面 + 判定题校验复杂,见 oracle 批 B §6)。**Owner 要 v0 就开放"用户建市场"再加,单独一节。**
- 押注资产 = D-017 免费铸造 KCC-20 测试币(零价值);动的真钱只有每笔几毛 KAS 手续费。

## 1. 架构
- **复用现有 TG bot 身份**(D-023),把它的命令处理接到 proto-v0 API(现默认连已下线的 :3200,要改指向主网 console 127.0.0.1:3202 的 proto 路由)。
- 数据流:外部用户 → Telegram → bot(本机, long-poll)→ proto-v0 API(回环)→ relay/结算。**不开任何对外 HTTP 端口**;Telegram 是唯一对外面。
- bot 与 console 同机;bot 崩不影响 console/结算驱动。

## 2. 🔴 bot 必须当鉴权/身份/限额层(最关键)
proto 路由本身**无鉴权**(J2 核:只靠回环绑定挡)。bot 一旦把外部用户接进来,**bot 就是那道鉴权边界**,不能裸转:
- **身份绑定**:TG user_id → KANet 身份/钱包(下注要签名的那个)。**必须持久**——现有 `/link` 只存文件、重启即丢(memory reference-tg-link-binding-file-only),要改成库持久 + 重启不丢。绑定要防冒认(TG user 与钱包的绑定证明)。
- **限额**:单用户单次/单日下注上限、单市场上限、全局速率限。防单用户刷爆。
- **fee 预算防护**:每笔下注的 KAS 手续费出自 relay(proto-v0-funds),外部可发起 ⇒ **外部下注会消耗 relay 的 fee 预算**;叠加 T-SETTLE-BALANCE-DOS 的 5 KAS 硬顶,fee UTXO 会被外部活动快速耗尽/触顶。要:relay fee 余额监控 + 低于阈值拒新注(而非广播失败) + 与 DoS runbook 合流。
- **输入校验**:所有外部输入(市场 id、金额、侧)严格校验 + 拒注入;金额/侧走 proto 受理门(含 oracle 批 B 的 outcome_end 门 + side_label 防点错侧)。

## 3. 数据暴露(D-021)
- bot 对外只展示:市场问题/两侧/赔率/deadline/结果、用户自己的持仓与赔付 txid。
- **不发**:密钥、relay 地址余额/内部账、其他用户信息、内网端点、未修复利用细节。
- 展示"冻结市场"要带状态(不显 winning_side 像有赢家,承 oracle 批 B C1 展示 SHOULD)。

## 4. 结算/结果链路
- 下注 → proto register_append(经 console/relay)→ 落链 → 用户可查"已确认"。
- 判定 → 结算驱动 → claim → 用户查"赢/输 + 赔付 txid"。
- 结果通知:bot 主动 DM 用户结算结果(复用老系统 pollSettleResults 形态,指向 proto)。

## 5. 复用 vs 新写
- 复用:现有 TG bot 命令框架 + 身份/DM 管道;proto-v0 的市场/下注/查询 API;oracle 批 B 的受理门/side_label。
- 新写:TG user→钱包持久绑定;限额/速率/fee 预算防护层;proto 路由的 bot 侧适配。
- **不改** proto/结算/oracle 内核。

## 6. 上线前置 + 分期
- **前置**:oracle 批 B 合 + refund 执行(有价值市场,但 v0 零价值测试币可先行)。
- 分期建议:A 只读(浏览市场/查持仓,无写)先上,验展示 + 身份绑定 → B 下注(限额+fee 防护)→ C 结果通知。
- 测试网整轮验(建市场→bot 下注→判定→bot 通知结果)后再上主网,主网 Owner GO。

## 7. 待 Owner 定
- v0 是否含"用户建市场"(默认不含,运营建)。
- 单用户/单日/单市场下注上限的具体数(零价值测试币,但要防刷)。
- 是否需要 KYC/准入,还是任意 TG 用户即可玩(测试期倾向任意用户 + 限额)。

## 8. 待 NWT 红队(重点)
- bot 作为无鉴权回环 API 的唯一鉴权边界:身份绑定防冒认、限额绕过、注入面。
- 外部下注对 relay fee 预算 + DoS 硬顶的耗尽/放大。
- TG user→钱包绑定的持久化与冒认防护。
- 数据暴露面(D-021)。
- 与 oracle 批 B 受理门/side_label/outcome_end 的自洽。
