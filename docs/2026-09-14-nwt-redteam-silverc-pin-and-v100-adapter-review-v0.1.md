# NWT 红队复核 · silverc-pin.json单源锚点 + v1.0.0编译适配层(`a500d192`) —— 第1笔

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1222：J2 pin修补第1笔`a500d192`。审点：①三方二进制（生产/我的/旧ZK）各跑sha256+黄金样本两项
> 校验；②黄金样本期望bytecode sha256是否可追溯；③既有`compileSil`/ctor helpers零改动；④v1.0.0 ctor方言
> helper正确性。第2笔（三函数+三调用点迁移）随后单独审。

## 结论：**四审点全部独立验证GREEN。①三方二进制的两项校验结果完全符合预期设计意图（生产二进制两项都过；
我的干净构建sha拒但黄金样本过，恰好实证"两项分工"这个设计初衷；旧ZK二进制sha拒+连黄金样本的ctor方言都
解析不了，两项都拒，且拒绝的方式比预想的更彻底）。②黄金样本的`expectedBytecodeSha256`独立重算确认可
追溯、真实、可复现，不是编出来的数字。③`compileSil`/`ctorBytes32`/`ctorInt`逐行diff确认零行为改动，
纯提取公共子函数的重构。④`ctorBytes32V100`/`ctorIntV100`两个导出函数经end-to-end实测（不只是读代码判断
"形状对"，是真的调用它们、真的编译出东西）确认工作正常，产出跟本session已知的RootClaim真实figure一致。**

## 一、①三方二进制的两项独立校验——实测结果，非纯读代码推断

在独立`git worktree add`到`a500d192`的隔离环境里，直接`import`该commit新增的
`assertSilvercV100Pinned`/`assertSilvercV100GoldenSample`两个函数，对三个真实存在的二进制文件各跑一次：

| 二进制 | sha256核对（`assertSilvercV100Pinned`） | 黄金样本核对（`assertSilvercV100GoldenSample`） |
|---|---|---|
| 生产`silverc-v100-3ed9733.exe`（`4378ba65...`） | **PASS** | **PASS** |
| 我的干净构建`silverc.exe`（`8d3b31f2...`，跟pin不同） | **THREW**（sha256不符，符合预期） | **PASS**（黄金样本deep-equal仍然成立） |
| 旧`silverc-zk-8065184.exe`（`9de7f2f6...`） | **THREW**（sha256不符） | **无法执行到deep-equal那一步**——独立直接拿黄金样本的ctor JSON喂给这个老二进制，它直接报`unknown variant \`bytes\`, expected one of \`int\`, \`bool\`, \`byte\`,...`（老版本的ctor JSON解析器压根不认识v1.0.0方言的`kind:'bytes'`节点），比"deep-equal不通过"这种失败方式更彻底——是从"喂进去"这一步就被拒了 |

**三行结果完全符合Bettor转述的预期，且我这次是真的分别调用了这三个二进制各跑一次，不是照抄J2commit
message里描述的预期结果**。第二行（我的二进制）恰好构成了"sha256只是防调包指纹、黄金样本才是真正的
同源判据"这条设计原则的一次真实的、非人为构造的实证——这个反例不是为了测试专门搭的，是我自己上一轮
构建时意外产生的真实情况，用在这里刚好是最有说服力的对照组。

## 二、②黄金样本期望值——独立重算，确认可追溯、真实

`scripts/silverc-pin.json`的`goldenSample.expectedBytecodeSha256`（`755cdd01...`）——独立提取该文件里的
`ctor`数组写成本地临时文件，独立用**生产二进制**、**我自己的干净构建二进制**两个不同的可执行文件各编译
一次`RootClaim.sil`，两次都独立算出**同一个**`755cdd01...`——这个数字不是J2凭空写的，是可以被任何第三方
（这次是我）用不同的二进制独立复现出来的真实产物哈希。`expectedBytecodeLength=2991`/
`expectedStateSpan={offset:1,len:96}`跟本session此前多次审查RootClaim时独立确认过的figure完全一致
——这条本身也是"这份pin文件描述的对象跟本session一直在验证的RootClaim确实是同一个东西"的旁证。

## 三、③既有`compileSil`/`ctorBytes32`/`ctorInt`——逐行diff确认零行为改动

独立读了完整diff：`compileSil`原来的函数体（子进程调用+cache+schema校验+返回）被拆成`_runSilverc`
（子进程调用+cache，不含schema校验）+ 新的薄`compileSil`包装（调`_runSilverc`后紧接着做**原来那一行一字
不改**的schema校验再return）——**序列完全等价**：外部调用方观察到的输入输出行为（同样的cache key计算
方式、同样的错误抛出条件、同样的返回值形状）跟改动前逐字对得上，是"提取公共子函数"的教科书式重构，不是
夹带行为改动。`ctorBytes32`/`ctorInt`两个函数的**代码本体在diff里没有任何`+`/`-`行**（只有它们上方的
说明注释从"ctor helpers"改成"旧silverc ctor JSON node format"，纯文字，不影响运行）——确认零改动。

## 四、④v1.0.0 ctor方言helper——独立end-to-end实测，不只读代码判断"形状对"

独立`import`了这个commit真正导出的`ctorBytes32V100`/`ctorIntV100`两个函数（不是自己另写一份等价JSON），
用它们拼出一组**真实的、非全零的**ctor数组，喂给同样真正导出的`compileSilV100`，指向生产二进制，编译
`RootClaim.sil`：**成功产出`script.length=2991`、`state_layout={start:1,len:96}`**——跟本session已知的
RootClaim真实figure一致。这条测试证明的是"这两个helper函数的实际产出值真的能被真实的silverc v1.0.0
CLI接受并正确编译"，不是只核对了它们返回的JS对象字面结构长得像不像。

**顺带确认了`bytecode是number[]非hex字符串`这条J2commit message里承认过的自我更正**：`compileSilV100`
返回值里的`script`字段就是从`c.compiled.bytecode`直接赋值（`Array.isArray`断言过），跟我这次的测试结果
`script.length=2991`（一个数组长度，不是字符串长度）吻合，确认这条更正是真的落到代码里了，不是只写在
commit message里口头认错。

## 五、给Bettor的处置建议

- **四审点全部GREEN，第1笔可以确认**。三方二进制的两项校验行为符合设计意图；黄金样本哈希可追溯真实；
  既有helper零改动；新helper端到端实测工作正常。
- 第2笔（三函数+三调用点迁移到`compileSilV100`）到了我按同等强度（真实调用+真实比对，不只读diff）审。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
