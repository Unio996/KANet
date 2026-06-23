# 部署纪律 Checklist(DoD-E:堵 committed≠live)

> 2026-06-08 Bettor 起。本会话反复撞 cp≠ship / push≠pull / committed≠live(refund 修差点留 :3300、UI URL 注释残留、Console 起在 commit 前 16s 误判…)。固化成一条龙,大众测试前/中每次上线必走。

## 一、ship 一条龙(改任何 :3200/:3300 跑的代码)
1. **commit** —— `git commit`(讲清改了啥)。**cp 到别节点 ≠ ship**(别人 pull 不到)。
2. **push** —— `git push origin docs/oracle-v06-spec`。**push ≠ 别节点有了**(origin 有 ≠ 工作树有)。
3. **pull 每个跑该码的节点** —— :3200 **和** :3300 各 `git fetch && git merge/pull origin`。跨节点必双 pull。
4. **restart 该节点 Console** —— tree-kill PID(`taskkill //T`,relay 是子进程,普通 kill 会孤儿/重复签名)+ kanet-start.sh 重起,**加载**新码。
5. **验 live(关键)** —— 确认跑的 Console 真装了新码:**PID StartTime 晚于 commit/文件改动** + **实测行为**(curl 接口/看链),**不靠 git log 时间戳判**(本会话误判教训:commit 时间戳晚于文件改动是常事)。

## 二、报数模板(deployer ship 完必报)
> commit `<sha>` push origin ✓ + :3200 pull+restart(PID `<id>` @`<time>`)✓ + :3300 pull+restart ✓ + 验 live: `<behavior test>`(curl/链)。

## 三、Bettor 关2 验 live 铁律
- **看行为不看时间戳**:实测打接口/看链确认新行为生效,不拿 git commit 时间推断。
- **撞 committed≠live 嫌疑**:先重跑实测,别掐表。
- **跨节点**::3200 验完还要确认 :3300 同 HEAD + 同行为(分布式漂移根源)。
- **注释也算**:URL/常量改动连注释一起改(本会话 /api/oracle/prevet 注释残留教训),lint 守 0 残留。

## 四、固化(可选加强)
- pre-deploy 脚本:`deploy.sh <node>` = fetch+merge+tree-kill+start+health-check,一键防漏步。
- lint-kanet 加规则:废弃 URL/旧端点名 0 残留(含注释)。
- 大众测试期:任一节点 restart 前频道喊一声(避撞 + 防双签)。

## 五、silverc binary pin(跨节点 determinism 铁律, 2026-06-20 near-miss 后加)
**根因(2026-06-20)**: J1 May20 silverc build 疑与 canonical 编同源 .sil 出不同字节 = 跨节点 determinism 红旗(不同 build → 不同 template_hash → 不同 P2SH → 共识 mismatch)。whole-repo-sync **只 sync 源码不 sync 编译器** = 漏。J1 全程零 deploy(只 probe estimate)= 侥幸无 on-chain 污染。⚠ offline 重编字节会被 **ctor/state 值混淆**(dummy ctor vs 实 landed ctor 差几字节), 多人离线比对各报不同数(493/505/507)都因 ctor 不同 = 不可作 build-分歧判据。

**铁律**:
- **canonical 定义 = 能重现链上 DoD-landed revealed 字节的那个 silverc build**, **非多数决**(NWT 纠正), **非 offline 重编**(ctor 混淆)。
- **🔑 终锚 = 链上 revealed redeem 字节(NO TX NO TRUTH 套 bytecode)**: 从 DoD spending tx 的 input scriptSig **末 push(redeem reveal)** 提实字节(operator :3200 域, KANet-UI 2026-06-20 提取法: getBlock(block_hash,includeTransactions)→ 找 spendTx → input[0].signatureScript 解最后一个 data-push 长度)。**链上实测锚 = 505B ShardLeaf_direct / 851B RootClose / 874B RootClaim**(canonical build da9fc22f 重现 851/874)。任何 build 的 offline 输出必对此核。
- **silverc binary 必进 whole-repo-sync 同 commit**(跟 .sil 源一起, 不能只 sync 源)。
- **部署前校验**: 节点 silverc 编出 == 链上 revealed 锚(505/851/874), 不一致 = 拒部署(该节点编的合约 template_hash ≠ 链上 = 共识 break)。
- **build-determinism 测协议**(诊断分歧, 别被 ctor 混): 同源 .sil + **同一份 ctor JSON(实值非 dummy)** + 不同 silverc → 比 redeem 字节, 变量只留 silverc binary。

## 验收(DoD-E)
本 checklist 落地 + 团队照走一次完整 ship(commit→push→双 pull→双 restart→验 live)零漏步 = E 绿。
