# NWT · 2-1 热钱包硬上限与冷热分离规格 v0.1（既有资金账号导入前置）

> **Status**: DRAFT-FOR-REVIEW v0.1（2026-09-14 · NWT · docs only，只写规格不落码不执行）
> 派工：Bettor 1130/1132。前置背景：Owner 要把旧主网系统的 relay 账号迁进新主网 console（`C:\KANet\kasia-console\data\console.db`
> 19 行有地址+加密助记词，密钥用 `C:\KANet\kanet.env` 的 key，与现有两把不同）。导入端点已存在
> （`POST /relays` 助记词 / `POST /api/relay/import-privkey` 裸私钥），但导入即落 `relay_nodes` 行——一旦这行有
> 地址+密钥，`startAll()`/`relay-health-monitor.js`/`system-repair.js` 三条既有自动路径（GO-E 系列已反复验证）
> 都会把它自动拉起，私钥即刻进相应子进程内存——这正是本会话 GO-E 全程反复确认的"密钥常驻=风险"那件事，只是这次
> 换成了**有真实余额**的账号，不是新建的验证用途空账号。本规格回应 NWT 2-1（`docs/2026-09-07-NWT-mainnet-real-money-preconditions-v0.1.md`）
> 那条一直悬而未决的"每 relay 资金上限 + 热钱包总额上限写死 env + 冷热分离"，现在有真实分布数据可以定具体数字。

## 0. 一句话

**给两条写死的数字硬上限（per-relay + 总额）+ 一条写死的冷地址拒绝清单，三条都在唯一的私钥入内存前置点
（`relay-manager.js:startRelay()`）强制检查——不新增第二个检查点，不靠导入端点自己把关（那只是更友好的早失败，
不是安全边界本身）**。

## 1. 真实分布（Bettor 1132 实查，`console.db` 19 行，链上合计 ≈21,890.76 KAS）

| 分类 | 账号 | 余额(KAS) | 处置 |
|---|---|---|---|
| 巨额 | Trader-B | 20,301.72 | **冷，永不导入进任何 relay 进程**（Owner 已原话钦定） |
| 中大额 | MarketMaker-A | 1,004.996 | **冷，默认不导入**（见 §2 理由，不是余额一个维度决定的） |
| 中额 | NWT | 540.15 | 可导入，落在建议 per-relay 上限之内（见 §3） |
| 小额 | 其余 ≤21.5 的账号（6 个左右，19−10 stress−NWT−MarketMaker-A−Trader-B） | 各 ≤21.5 | 可导入 |
| 极小额 | 10 个 stress 测试账号 | 各 ≈0.5 | 可导入，不需要特判 |

## 2. 冷/热分类的判据——不只看余额，也看"是不是已经是别处的具名钥匙"

**Trader-B 冷**：余额本身(20,301.72)远超任何"验证/小额操作"合理需要的量级，Owner 已经原话钦定"绝不进 relay
进程"——这条不需要我再论证，直接写进拒绝清单。

**MarketMaker-A 我也判冷，但理由不是"余额比NWT大"这一个维度**：
1. **余额本身(1,004.996)已经超出"中额验证/小额操作"的合理范围一个数量级**——跟 NWT 的 540 比，两者本来就该分属
   不同层级，不是同一个 per-relay 上限该覆盖的对象。
2. **名字带业务角色语义**（"MarketMaker" = 做市商）——虽然我 `grep` 了一遍源码/env，"MarketMaker"/"MARKET_MAKER"
   这个具体字符串**没有**命中任何硬编码常量（不像我上一轮红队意见里点名的 `TRADER_B_ADDR`/`BROKER_KASPA` 那样是
   源码具名常量），所以它不像那两个一样"结构上必然撞 Rule 1"——**但一个显然是为做市用途保留的账号，导入进一个
   目前只做验证用途的 relay，本身就是把"以后迟早要接做市自动化"这条路径提前铺好**，跟 GO-E 系列反复强调的
   "先专用隔离、以后要转常驻必须另起一次独立 GO"这条纪律精神相悖。
3. **结论**：MarketMaker-A 归入冷地址清单是**保守但可讨论**的建议——如果 Owner 明确要现在就用它做验证（而不是
   留给以后真的做市时用），可以移出冷清单，但那应该是一次**独立的、显式的 GO**（说清楚"这次就是要让它活着"），
   不能顺着这次"零引用小额先行"的批量导入捎带过去。

**NWT/小额/stress 账号可导入**：余额量级都在"就算私钥泄露，损失可承受"的范围内（见 §3 数字来源），且没有一个
在源码/env 里带具名引用（下面 §5 的零引用检查覆盖这一条，导入前逐个跑一遍，不是假设）。

## 3. 两条写死的数字上限

**per-relay 上限：建议 `RELAY_HOTWALLET_PER_RELAY_MAX_KAS = 800`**

依据：必须**覆盖** NWT(540.15)，必须**排除** MarketMaker-A(1,004.996)——540 和 1,005 之间取一个有余量的整数，
800 留了 260 的缓冲（NWT 如果后续小额增值不会一下子撞线），同时跟 MarketMaker-A 之间留了 205 的安全距离（不会
因为汇率/记账误差之类的边缘情况意外把它放进来）。**这个数字不是精确科学算出来的，是按"覆盖当前已知要放行的最大
个案 + 排除当前已知要挡住的最小个案"这个区间取的，Owner 若有更明确的风险容忍数字应该覆盖它**。

**总额上限：建议 `RELAY_HOTWALLET_TOTAL_MAX_KAS = 1000`**

依据：全部"可导入"账号加总的最坏情况 = NWT(540.15) + 6个×21.5(最坏128.5) + 10个×0.5(5) ≈ 674 KAS——1000 留了
约 48% 的缓冲(未来同类小额账号增加也不会立刻撞线)，同时**远低于**两个冷账号任何一个的量级——即便冷清单检查
出于某种未知原因失效（防御失效场景），总额上限本身也会在"总敞口滚到四位数"这个门槛上单独拦一次，不依赖冷
清单单一路径生效。

**这两个数字都建议写进 `kanet.mainnet.env`，跟 GO-B 那批 env 常量同一份纪律（写死、不做成 DB 可改配置——DB 配置
能被任何有 console 写权限的调用方悄悄改掉，env 需要重启进程才能改，多一层"改了会被人注意到"的摩擦）**。

## 4. 冷地址拒绝清单

`RELAY_HOTWALLET_COLD_ADDRESSES`（env，逗号分隔的 kaspa 地址列表）：
```
RELAY_HOTWALLET_COLD_ADDRESSES=<Trader-B地址>,<MarketMaker-A地址>
```
**任何候选地址在 `startRelay()` 里先查这个清单，命中直接拒绝**（`{ok:false, reason:'cold_address_denied'}`），
不管这一行是怎么进 `relay_nodes` 的（正常导入端点/未来任何新增的写入路径/理论上的手工 DB 操作）——**这条检查
放在 `startRelay()` 内部而不是只放在两个导入端点，是因为 `startRelay()` 是本会话 GO-E 系列反复确认过的唯一
私钥入内存前置点，导入端点的检查只是更友好的早失败，不是安全边界本身，边界必须钉在无论从哪条路径最终都要
经过的那一个函数里**（同 GO-E 那三条自动复活路径最终都收敛到 `startRelay()`/`account_not_found` 是同一个道理，
这次反过来利用这个"单一收敛点"性质做正向的准入检查）。

## 5. 三条检查的具体落点（`kasia-console/src/services/relay-manager.js:startRelay()`）

现有函数在 `account_not_found`/`no_address`/`network_mismatch` 三个既有检查之后、`buildRelayKeyEnv()`
组装环境变量（=私钥即将进子进程环境）之前，新增：

```js
// 1) 冷地址拒绝清单（§4）——不管这行怎么进 relay_nodes 的，命中就拒
const coldList = (process.env.RELAY_HOTWALLET_COLD_ADDRESSES || '').split(',').map(s => s.trim()).filter(Boolean);
if (coldList.includes(account.address)) {
  return { ok: false, reason: 'cold_address_denied' };
}

// 2) per-relay 上限（§3）——查候选自身余额，超了拒绝
const perRelayMax = Number(process.env.RELAY_HOTWALLET_PER_RELAY_MAX_KAS);
const candidateBalanceKas = await _queryBalanceKas(account.address, net);  // 复用 api/relay.js:371 同款
                                                                            // getSharedRpc + getBalancesByAddresses
if (Number.isFinite(perRelayMax) && candidateBalanceKas > perRelayMax) {
  return { ok: false, reason: 'per_relay_cap_exceeded', balance: candidateBalanceKas, cap: perRelayMax };
}

// 3) 热钱包总额上限（§3）——候选余额 + 当前所有"正在跑"的relay的余额 之和
const totalMax = Number(process.env.RELAY_HOTWALLET_TOTAL_MAX_KAS);
if (Number.isFinite(totalMax)) {
  const runningTotal = await _sumRunningRelayBalancesKas();  // 遍历 _relays 里 child 存在的条目, 各自查余额求和
  if (runningTotal + candidateBalanceKas > totalMax) {
    return { ok: false, reason: 'hotwallet_total_cap_exceeded', running: runningTotal, candidate: candidateBalanceKas, cap: totalMax };
  }
}
```

**未设 env（`Number.isFinite`判false）= 不启用该项检查，向后兼容现有行为**——跟这个仓库其它 env 开关的既有
写法（`!== '1'`才生效那一类）同一个模式，不是本规格发明新范式。**但这条纪律本身要求：一旦真的要导入有真实
余额的账号，这两个 env 必须先设，不能带着"没设=不检查"的状态就去导入**——这是执行流程上的前置条件，不是代码
本身能强制的，需要写进导入 runbook 的检查清单（KANet-UI 迁移 runbook v0.1 那份）。

**`_queryBalanceKas`/`_sumRunningRelayBalancesKas` 是本规格建议新增的两个小 helper，不是已有函数**——前者
复用 `api/relay.js:371` 已经在用的 `getSharedRpc`+`getBalancesByAddresses` 调用形（不是发明新的余额查询路径，
是把已经验证过能工作的那段逻辑抽成 helper 给 `relay-manager.js` 内部用）；后者需要遍历 `_relays` 模块级状态
（`relay-manager.js:26` `const _relays = {}`）里所有 `child` 存在的条目, 对每个已知地址查一次余额——**这条本身
有一个需要正视的性能/时序代价**：每次 `startRelay()` 都要对所有当前活着的 relay 各查一次链上余额，relay 数量
多时这会拖慢启动速度，且余额查询本身有网络延迟/失败可能——**建议给 `_sumRunningRelayBalancesKas()` 加一个短
TTL 缓存（如 30 秒），查询失败时 fail-closed（拒绝启动，不是当作0继续放行）**，这条实现细节留给 J2 落码时定，
本规格只钉"必须查真实余额、失败不能放行"这条原则。

## 6. 为什么不在 `sendCommandAsync`/`transferAndConfirm` 加限额

这两个是**转账动作**的唯一 choke point，理论上也可以在这里加"单笔/累计转出上限"——但那解决的是**另一个问题**
（防止已经在运行的 relay 转出过量资金，更接近 `trade-limits.js` 现有那套`per_order_max_kas`/`daily_total_max_kas`
的业务性质），跟 NWT 2-1 原话要的"per-relay资金上限+热钱包总额上限"**不是同一件事**——2-1 关心的是"这把私钥
值不值得进程内存常驻"这个**存在性**风险（不转账、只是活着，风险就已经在了），不是"转多少钱"这个**流量**风险。
**两条都该有，但本规格只覆盖前者（§3-§5）——后者如果 Owner 认为也需要给 relay 转账加类似`trade-limits.js`
的上限，应该是另一条独立规格，不要混进这次的"导入前置"审查**。

## 7. 对"分批：零引用小额先、有资金后"的判定——**认同，且给出具体批次顺序**

**认同分批**，理由：这批 19 行账号第一次要在**新主网 console**（不是旧系统）里跑起来——即便每一条数字上限都
写对了，"这套新 console 的 relay 子进程启动/停止/健康监控机制在**带真实资金**的场景下有没有哪个环节表现跟预期
不一致"这件事，本身就该用最小代价先验证一遍，不该让 20,301 KAS 那个账号（哪怕它现在是冷不导入）所在的**同一批**
迁移动作，第一次尝试就带着中额账号一起上。

**具体批次建议**：
1. **第一批**：10 个 stress 账号（各 ≈0.5 KAS）——先验证导入流程本身（`POST /relays` 或 `import-privkey`）+
   §5 三条检查的**代码是否真的按预期工作**（专门构造一次会被 per-relay/total 上限拒绝的场景，确认真的拒绝，
   不是只测试"正常情况能过"这一面）。
2. **第二批**：§1 表格里"其余 ≤21.5"那一档账号——量级仍小，但不再是专门的测试账号，是真实历史账号，多验证一层
   "这些账号导入后 console 侧的既有业务逻辑（Mind 自动配置/skills 目录等 `POST /relays` 顺手做的事）会不会对一个
   "已有历史"的账号做出不合适的假设"（这条本规格没有展开分析，留给 KANet-UI 迁移 runbook 检查）。
3. **第三批**：NWT(540.15)——第一次真正让 per-relay 上限"卡在有意义的量级附近"生效的账号（540 离 800 的上限还有
   余量，但已经是这批账号里最大的"放行"个案），建议这一批**必须**先看到第一批的 per-relay/total 拒绝场景测试
   通过后才做。
4. **MarketMaker-A / Trader-B**：不进入任何批次——按 §2 归为冷，除非 Owner 另下一次独立 GO。

## 8. 待 Owner/Bettor 拍板的开放项

- §3 的 `800`/`1000` 两个具体数字是我按已知分布区间给的建议值，不是唯一解——如果 Owner 有更明确的风险容忍
  表述（比如"单个 relay 最多能承受丢多少钱"这种原话），应该按那条覆盖本规格的建议值。
- §2 MarketMaker-A 归冷是我的保守判断，不是不可讨论——如果 Owner 明确现在就要用它做验证，需要走独立 GO，不能
  搭这次批量导入的顺风车。
- §5 的余额查询失败时 fail-closed 会不会在 RPC 抖动时造成"明明该放行却被拒"的误报——这条需要 J2 落码后跑几次
  真实场景观察，本规格只钉方向（失败不能默认放行），具体重试/超时策略留实现时定。
