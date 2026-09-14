# NWT 红队复核 · `assertZkHandoffTmplCoherent`落码（`8a0a7d83`）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1291：①位置确在任何转账/广播构造之前；②调用链上游无宽泛catch把throw转成继续（同1246思路）；
> ③测试的"接线核实"是grep真实源码而非mock。

## 结论：**GREEN。三点均独立核实通过。独立另建worktree（真npm install）重跑新测试8/8 PASS+既有
coherence-gate测试无回归，lint 0 errors。**

## 一、①位置确认——独立读完整函数体

独立读`buildZkHandoffRequestV2`480-575行区间原始源码（不是读diff片段）：`assertZkHandoffTmplCoherent`
调用紧跟在5处既有env-missing检查之后，且在`ensureGateTmplHashFresh`/`computeCloseZkTmplAnchor`调用
**之前**——这两步都不是转账/广播，真正的第一次资金动作（`transferAndConfirm`）在这些检查之后很久才
出现（跟我在`09ed3772`审计设计文档时独立确认的位置一致）。`ps`查询确认是**扩展同一次SELECT**（加
三列，不是新增第二次查询）——不是"顺手改了查询但可能查两次不同时刻的值"这种隐患。

## 二、②上游catch核实——独立追查两条真实调用路径

独立`grep`确认`buildZkHandoffRequestV2`只有两处真实调用点：
- `zk-autonomy-ticks.mjs:359`（自治daemon路径）：`try{...}catch(e){errored++; _writeZkAutonomyErrorEvent(...); continue;}`——独立确认这条catch**只递增errored计数器+写事件记录+continue下一个市场**，不递增`dispatched`、不清除任何"pending"标记、不会把这次throw误判成"已成功handoff"。外层还有第二层`catch(e){errored++;...}`兜底，同样语义。
- `pool.js:1952`（admin端点路径）：`catch(e){console.error(...); return reply.code(500).send({ok:false, error:...})}`——独立确认返回HTTP 500+`ok:false`，不是被吞成200成功响应。

**两条路径均无宽泛catch把throw转成"继续当作成功"**，跟1246审`enforceCloseAttest`时的判据同一标准。

## 三、③测试"接线核实"——独立确认是真grep源码

独立读测试文件`wiring`小节：`readFileSync(srcPath)`+`indexOf`字符串定位（`envCheckIdx`/`callIdx`/
`computeIdx`三个锚点），断言三者都能在源码里找到且顺序正确——这是对**磁盘上的真实源码文本**做字符串
搜索，不是mock掉`buildZkHandoffRequestV2`再断言"mock被调用过"这种自证式测试。独立重跑该测试确认三个
锚点的真实偏移量（`envCheckIdx=39437 < callIdx=39671 < computeIdx=40669`），顺序验证成立。

## 四、独立重跑测试+回归检查

另建独立worktree（真`npm install`，非symlink，junction检查前后均0跨树，43→42个worktree）：
- `bshard-close-transport-zk-tmpl-coherent.test.mjs`（新文件）：**8/8断言全PASS**（1正向含大小写
  不敏感sanity + 4负向 + 1wiring核实，负向④独立确认错误信息同时含marketId+字段名+db值+env值，可
  直接定位不用反查代码）。
- `bshard-close-transport-coherence-gate.test.mjs`（既有）：**all checks passed，无回归**。
- lint两个改动文件：**0 errors**。

## 五、其它独立核对

- NULL处置口径独立确认与T-LEGACY-NULL-COLS一致（同一条"NULL=fail-closed拒绝"纪律在观测层
  (migrate.js诊断)与花钱前硬门(本函数)两处各自的体现，不是同一段代码但哲学一致）。
- 比对对象独立确认是`process.env`（函数签名`envVals`参数明确不在函数内读env，读取职责留在调用点，
  跟既有5处env检查同源，不引入第二套读取逻辑）——跟T4设计文档§3.3的既定要求一致。
- 已知可用性瑕疵（env漂移会拦下不需要重算的旧市场）已在函数头注如实记录，不隐藏，属于"保守换安全"
  的既定取舍，不是被忽略的缺陷。

## 六、给Bettor的处置建议

- **GREEN，可以合并**。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
