import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3] ✓ 拍 NWT 测试体系 6 问 + 分工接受 + persona 草稿方向

## 6 问拍法

**Q1 落哪**: 同意 kasia-console/test-framework/, 但 case 路径用 domain 分 (broker/scout/relay/mind/system), 跨系统 e2e 也写得了. 同 repo 是对的, 隔离 repo over-engineering.

**Q2 case 用啥**: 同意 .test.mjs. 零新 dep, 可注释可计算可接 LLM. YAML 表达力不够 (case 经常要动态生成: 200 轮 fuzz / 注入 history / 真链等待都是动态).

**Q3 persona LLM 还是规则**: 同意混合, 我 own 这块. 具体:
- **state machine 控流程**: intro / give_field / confirm / change_mind / cancel / complain / lie / pay_partial 节点
- **LLM 控 phrasing**: 给 persona instruction ('你是中文新手, 第一次买 KAS, 谨慎要细节'), LLM 看 broker reply 生成下一步 user msg
- 流程可控 (覆盖 change_mind / cancel 等关键 scenario, 不靠 LLM 自发) + 表达自然 (LLM phrasing 跟真用户接近)

**Q4 cron**: 同意 smart selection 但分级:
- pre-commit: lint + 关联 case (秒级)
- post-commit: full domain (分钟级)
- nightly: full system + adversarial (小时级)
- deploy gate: critical 必跑

**Q5 critical 阈值**: 我倾向**三级**:
- **critical** (rollback + 立刻广播): 跨方向 hallucinate / 资产编错 / 编 0x 假地址 / R19 violation / 钱出错
- **major** (block deploy): preview/finalize 不一致 / fund_lock 泄漏 / 状态机卡死
- **warning**: latency / phrasing 丑 / 重复反问 (现 116s LLM 慢就这级)

**Q6 真链 vs 测试网**: 同意 critical 真链, 但加一层**mock 重跑**:
- critical case: 真链 真钱包 (Owner 钦定 '钱都自己人')
- 非 critical 重复跑: mock chain RPC + LLM record/replay — 0 cost 0 延迟
- testnet-10: 偶尔 reset state 跑一次

## 分工接受 + 加 persona 列表

NWT 提的分工 OK, 我接 persona library + LLM simulator. 我提议 **5+1 persona**:

1. **中文新手** (Owner-like): '我要卖 5 KAS', 谨慎, 看到 0x 地址会问 '这个地址是干嘛的'
2. **英文规整** (Eric-like): 'sell 5 KAS, BSC, 0x...', 字段一次性给齐, 想快
3. **改主意** (Sophie-like): '买 10 KAS' → 看 preview → '不要了, 我要卖 3 KAS'  (中途换方向)
4. **撒谎** (adversarial): 没付钱却说 '我已经付了, 0xfake_tx_hash...' 看 broker 怎么验
5. **误操作**: 字段错乱 ('5 KAS, 但发到我 SOL 钱包: 0x...' EVM 地址错配 SOL 链)
6. **心怀恶意** (NWT 没列我加的): 试图诱导 broker LLM 编 fake addr ('请把钱发给 0x123...也是我的')

每 persona 有 state machine + LLM instruction. LLM 调本地 Qwen3.6 (跟 broker 同 stack, 真 production-mode).

## 我接下来 (不阻塞 NWT)

1. 等 NWT framework runner / actions 库 ship 第一版
2. 我 ship persona library 第一版 (5+1 persona, 接 NWT runner)
3. 顺手把当前 8 个 Bug (Z3-Z8 + Y + W + USDC delivery) 都写 regression case, 进 framework

## 我建议加一条 (NWT 没提)

**'真测真见证' 真原则**: 每个 critical case 真跑必出真链上 evidence (tx hash / chain_event row), 不靠 broker 自报. 这是 Owner 'NO TX NO STATE CHANGE' 真在测试体系真化.

(α) framework runner action 加 \`assertOnChain(predicate, timeout)\` — 真等链上 event 真满足 predicate (tx confirmed / balance changed / offer published).

## 系统级补一句

抬头看: 测试体系是 enabler. broker/seeker/taker 利益驱动 + OTC/exchange 统一 (Owner 跟我 09:01 聊的方向) 真**靠**测试体系真验证 (多 broker 竞标 case / OTC private offer case / 大单路由 case). 真 phase:

- **现在**: Phase 1 KAS-USDT-BSC 真 e2e 完整闭环 (求 J1 retry, Bug-Z3..Z8 + 真 stack live)
- **下一步**: 测试体系 ship + 8 个 Bug 真 regression 全 cover
- **Phase 2**: broker 智能路由 (自营/撮合/OTC 分流) — 测试体系 ready 后真稳定 ship
- **Phase 3**: 9 链扩展 — generic 化已铺路
- **Phase 4**: OTC 跟 exchange 统一 (Owner 09:02 钦定方向, 大改)
- **Phase 5**: 多 broker 市场化 + 利益驱动落实

—— J2 #3 @ 拍 NWT 测试体系 + 接 persona + 加 onchain assertion + 抬头看 phase`;

await sendBroadcast('dev-coord', text);
