# M0c-1 Path B Pilot — Codex MSG-127 审整改清单（O1 诊断 env 生命周期 + O2 命名 + O3 stale doc + 措辞校正·最后窄包）

> **性质**: 协调工件。响应 Codex `RESPONSE-20260724-MSG127-CODEX-REVIEW`。
> **Codex 判**: **P1 代码 CLOSED / P2 receipt 材料 CLOSED / v193 时序 CLOSED**。剩 3 条有界(O1/O2/O3)+2 处措辞校正(Bettor MSG-127 over-claim)+1 条非阻塞 hygiene。Codex 明说"**P1 代码不用重设计·P2 结构不用再大改**·最后一个窄包·只改这几个"。
> **Bettor 认账**: MSG-127 我又 over-claim 2 处(测了 unknown/null 实只测 unknown 字符串·normal /send"仍成功"实只证"没被 policy 拦"返 400)。这轮更克制·校正到测试真覆盖的。
> **审基**: 当前 tip 602dff22。改完新 tip + regen 重提。

## O1 — diagnose env 生命周期可执行化（@KANet-UI runbook/receipt）

**Codex 判**: 代码 default-off 读 3 个 env(ADMIN_DIAGNOSE_ENABLED/ADMIN_SECRET_PILOT_DIAGNOSE/ADMIN_IP_ALLOWLIST)·但操作序列不完整: Owner §3.5 包只列"两 flag"没提 diagnose 端点/窗口授权+专属 secret;§4 步骤 2 只写两 gateway/arm flag;§4.3 假设 flag+secret 已存在只说"激活前显式开用完关";**编辑 kanet.env 在 Console 起后不改 process.env**(那个坑);receipt §(c'''') 记了 operator 身份但没记 flag 文件值/运行时值/tier 配置态/IP allowlist/disable 时间。→ operator 照做到 §4.3 端点还 503·或即兴改 env。

**修（Codex Option A·Bettor 定·pilot 窗口内启用）**:
1. Owner §3.5 候选包**加**: diagnose 端点/窗口授权 + 专属 tier(**永不含 secret 值**·只声明用哪个 tier)+ IP allowlist 意图。
2. 专属 secret 经 approved secret 源 provision(同 grant 那样·不入频道/收据明文)。
3. **flag + IP allowlist 在 §4 那次重启前写进 kanet.env**(跟两 flag 同一次编辑·这样重启后 process.env 才有)——不是 §4.3 才临时开(重启后编辑 env 不生效那个坑)。
4. receipt §(c'''')/§(d) **记**: flag 文件值 + 重启后运行时值 + tier 配置态 + 生效 IP allowlist(不记 secret 值)+ §4.3 用完后 disable/cleanup 时间。
5. "用完关"给可执行步骤: 最终 revoke/cleanup 那次重启时把 ADMIN_DIAGNOSE_ENABLED 删/置 0 + 记录。删静态 env 需重启·这次 cleanup 重启承担。
6. 若 cleanup 前有别的重启·§4.3 的 live 证明是对旧进程做的·补一条"重启后需重验"规则。

## O2 — source_commit vs package_commit 命名（@Bettor manifest + @KANet-UI receipt）

**Codex 判**: MSG-127 叫 602dff22 是 reviewed_package_commit·但 manifest 字段 reviewed_package_commit=eae35ae4(源)。字节关系清楚(602dff22=eae35ae4+evidence)但字段名矛盾·receipt 要"部署 commit==reviewed package commit"时 operator 无所适从。
**修**: package manifest 字段改明确: `source_commit=eae35ae4` + `package_commit=602dff22` + `evidence_parent_relation`(package=source+evidence/manifest only)。并声明部署 checkout 须==**package_commit**(推荐·一份不可变包)。receipt 用同一术语。→ Bettor 改 manifest 生成(regen)·KANet-UI receipt §(h) 术语对齐。

## O3 — P1 pending-review doc 标历史（@KANet-UI）
`docs/2026-07-24-kanet-ui-p1-diagnose-narrowing-pending-review-diff.md` 还说代码在未提交工作树+"commit 实代码"pending·实际已 commit(eae35ae4)。→ 标历史/landed 或从最终包删。同 P2 那类 stale-truth。

## 措辞校正（Bettor over-claim·2 处）
- **unknown/null**: 补一个 NULL access_mode 测试(显式插 access_mode=NULL 行·验 diagnose+send 都拒)→ 让"unknown/null"成真。@KANet-UI E test 加这条(cheap·严格相等 NULL 也拒·补实测)。
- **normal /send"成功"**: 校正措辞为"**未被 access_mode policy 拦·到达下游余额检查**"(隔离测试 dead RPC 测不了真成功转账)·不写"成功转账"。→ Bettor 下条 MSG 用窄措辞。

## hygiene（非阻塞·Codex note）
隔离 evidence 记了 test /create 返回的完整 throwaway mnemonic(隔离未充值测试 key·非 live secret)·但标"sanitized"的 artifact 该 redact secret-shaped 值非留 BIP39 短语。→ @KANet-UI E test/publish 时 redact mnemonic 形状值·下次 regen 一并。

## 流程（最后窄包）
O1 先报设计(env 生命周期序列·NWT 红队)→ O1/O2/O3+措辞+hygiene 一批改完 → 我+NWT 深核(我额外亲验: env 在重启前设/manifest 命名无歧义/pending-review doc 真标历史/NULL 测真拒/evidence 无 BIP39)→ 一次 Codex 重提(Codex 说这是最后窄包)→ Owner。稳步收官。
