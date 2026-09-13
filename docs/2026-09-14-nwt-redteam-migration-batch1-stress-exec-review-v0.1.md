# NWT 红队复核 · 主网迁移第1批(stress)执行页(`a368b7d2`)

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1179：①拒绝场景探针失效副作用(空壳行)回滚路径；②form-urlencoded是否钉死；③§4后果讲透；
> ④明文边界；⑤与runbook v0.6§5.1/§6.2一致。GREEN后Owner开工。

## 结论：**GREEN-with-ONE-SMALL-FIX。四点(②③④⑤)独立核对代码后确认准确；①发现一个真实但很小的
文档缺口——探针万一没被拒绝、行真的被插入时，页面只说"停下回§1核实"，没写清那一行本身(空壳探针行)
要不要删、怎么删——不是安全漏洞，是收尾不干净，建议补一行再放行，不需要重新设计任何步骤。**

## 一、①探针失效副作用——发现一个小缺口

**独立读代码确认exec页§2的技术描述准确**（`kasia-console/src/api/relay.js:89-108`）：
- `resolvedAddress = address?.trim() || null`——显式传`address`时直接用，不需要`mnemonic`。
- `checkHotwalletAdmission()`调用**在`createRelayNode()`(INSERT)之前**，`admission.ok`为假时直接
  `reply.redirect`返回，**函数在INSERT之前就退出**——独立确认"行未被创建"这条描述属实，不是脚本自己
  判断"看起来像拒绝"。
- 拒绝reason字符串`'cold_address_denied'`与`relay-manager.js:102`的`checkHotwalletAdmission()`内部
  `return {ok:false, reason:'cold_address_denied'}`确认是同一处代码的同一个字符串。

**缺口**：exec页§2第5点"如果探针没有被拒绝...立即停止,不得继续本页任何后续步骤"——**没有写清楚
"如果那一行真的被插入了，这一行(空壳探针行,`mnemonic=null`)本身要不要清理、怎么清理"**。技术上这个
空壳行**确实无害**（`relay-health-monitor.js`的eligible判据要求`mnemonic_encrypted IS NOT NULL OR
privkey_encrypted IS NOT NULL`，`mnemonic=null`的这一行永远不会被health-monitor判定为eligible，不会
被自动拉起，跟一个手误的空名单行是一回事，独立读`relay-health-monitor.js:76-80`确认），但留着一行
"Trader-B地址+无密钥"的行躺在`relay_nodes`里，容易在以后被人误读成"这行是不是本来该有密钥但漏了"，
是收尾干净度问题，不是资金安全问题。**建议**：§2第5点补一句——"若探针行真的被插入，先按§6第3步同款
`POST /relays/:id/delete`删掉这一行探针记录，再回§1重新核实，不要把探针留下的痧迹跟后续第一批10行的
真实数据混在同一张`relay_nodes`表里"。

## 二、②form-urlencoded是否钉死——确认已钉死，且独立核实了这条坑的真实性

exec页§2/§3步骤里的body描述都**明确写了`application/x-www-form-urlencoded`**，不是留白让人自己猜。
**独立读代码确认这条坑是真实存在的**：`kasia-console/src/index.js:154`只注册了
`@fastify/formbody`——这个插件**只**解析`x-www-form-urlencoded`，不注册通用JSON兼容层；若调用方发
JSON body但content-type没被fastify内置json解析器正确识别（比如漏设content-type或用了不被识别的
类型），`request.body`可能解析不出`name`字段，命中`if (!name?.trim()) return reply.redirect('/relays')`
——**一个静默的、看起来"成功"（302到`/relays`，没有错误页）但什么都没做的空操作**，跟"以为导入了但
其实没有"这类误判完全对得上exec页描述的这个坑。**确认属实，且已经在步骤里明确写清楚要用哪种content-type
，不是隐患。**

## 三、③§4后果讲透——已经讲透，确认无遗漏

读了§4全文：`relay-health-monitor.js`的eligible判据(不需要adapter/不需要额外启用动作)+`startRelay()`
准入门会对这10行放行(逐条给出理由:不在冷清单/远低于per-relay 800/累计远低于total 1000)+私钥真实进
10个独立子进程内存——**四点都写了具体代码行引用，不是空泛描述，且明确把"这不是理论风险是确定后果"这句
放在最前面**，跟本会话一贯要求的"如实讲清楚后果不是免责声明"纪律一致。无遗漏。

## 四、④明文边界——独立读代码确认边界成立

- `kasia-console/src/services/crypto.js`：**全文0个`console.*`调用**——`decrypt()`本身没有任何打印
  路径，独立确认。
- `kasia-console/src/api/relay.js`：grep了所有涉及`mnemonic`/`phrase`/`privkey`/`secret`的
  `console.*`调用，**两处命中都只打印`name`/`address`（公开信息），从未把密钥材料内容本身interpolate
  进日志字符串**。
- exec页§3步骤1"一次性环境变量注入,绝不用命令行参数"（不进shell历史）+ 步骤4"该行明文助记词变量在这次
  POST调用返回后立即丢弃"——跟本会话此前已核过的迁移方法论一致，本页没有引入新的、未经审的明文处理方式。

## 五、⑤与runbook v0.6§5.1/§6.2一致性——确认一致，且exec页对"用哪一层测"给出的理由本身成立

runbook§5.1第3点原话要求"专门构造一次会被**第二层**(`startRelay()`内部)拒绝的场景"——exec页§2实际
走的是**第一层**(导入端点`relay.js:105`)的探针,不是直接调`startRelay()`。**这个偷换不是缺陷**：exec
页自己给出的理由——两个调用点`relay.js:105`和`relay-manager.js:206`调的是**同一个函数**
`checkHotwalletAdmission()`,不是两套独立实现——这条我在本会话`a65c28dc`/`39ae30b1`审查时就已经独立
验证过（那两轮review确认了准入检查代码只有一份、被两处调用点共享），exec页这里复用的是已经验证过的
事实，不是重新假设一个未经验证的前提。**确认与runbook意图一致**：两处共享同一份检查逻辑意味着测通
第一层等价于测通第二层，不是"抄近路省了一步"。

## 六、给Bettor的处置建议

- **GREEN-with-ONE-SMALL-FIX**：§2第5点补一句探针空壳行的清理步骤（见§一），补完即可放行，不需要
  重新设计任何机制或延后执行。
- ②③④⑤四点独立核对代码后确认准确，无新发现问题。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
