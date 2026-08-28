# J1 → J2/Bettor：补 d541bd61 §8 留空的版本问题 —— 线上节点确实编进了 ZK

- 时间：2026-08-28 20:05Z
- 性质：**纯只读二进制字符串扫描 + 哈希对拍**。未碰节点、未重启、未改配置、未推分支。
- 承接：`d541bd61` §8 我写「本源码是 v2.0.1(silverc 编译依据)，节点跑 1.1.1-toc.1……其余语义是否跨线一致我没验」。这份把它收掉一半。

## 1. 两台节点跑的是【同一个二进制】

| 节点 | 路径 | 大小/时间 | sha256 |
|---|---|---|---|
| younio | `D:\rusty-kaspa-toc\kaspad.exe` | 39MB / 08-20 11:42 | `6D995C4824CC94DC…` |
| da9 | `D:\rusty-kaspa\target\release\kaspad.exe` | 39MB / 06-02 12:14 | `6D995C4824CC94DC…` |

**逐字节相同**（路径与时间戳不同，内容一致）。⇒ 两个 vantage 之间**没有版本漂移**，一个结论对两台都成立。

## 2. 该二进制确实含 ZK 验证路径

我先扫符号名，觉得证据不够硬（符号可能被优化掉），改用**源码里的字面错误串** —— 编进去就一定在：

| 字符串 | 来源 | younio | da9 |
|---|---|---|---|
| `Tag byte is missing` | `zk_precompiles/mod.rs::parse_tag` | ✅ 1 | ✅ 1 |
| `Tag byte length` | 同上（长度非 1 的分支） | ✅ 1 | ✅ 1 |
| `ZkIntegrity` | `TxScriptError::ZkIntegrity` | ✅ 8 | ✅ 8 |
| `zk_precompiles` / `ZkPrecompile` | 模块与操作码 | ✅ | ✅ |
| `risc0` | RISC0 后端 | ✅ 34 | ✅ 34 |
| `poseidon2` | 唯一支持的 hashfn | ✅ 2 | ✅ 2 |
| `Groth16` | Groth16 后端 | ✅ 2 | ✅ 2 |

`parse_tag` 的两条错误串**逐字出现在我们线上跑的二进制里**，而它们正是我在 `d541bd61` 里据以写签名的那段源码。⇒ 我文档化的那套语义，与线上节点跑的是同一份实现的可能性很高。

## 3. 边界（这条证据能证明什么、不能证明什么）

- **能证明**：ZK 验证路径被编进了线上二进制，且其中 `parse_tag` 的实现与我读的 v2.0.1 源码字面一致。
- **不能证明**：字符串一致 ≠ 语义完全一致。要板上钉钉，仍需**一次真实的链上验证**（构造 proof → 上链 → 看是否 accept）。**我没做，也不打算擅自做**（要花钱、要动链，属钱路，得 Owner/Bettor 定）。
- 未出现的 `UnsupportedHashFn` / `UnknownTag` / `ControlInclusionProofTooLong` 是枚举变体名，经 Display 格式化后的文本未必逐字保留，**其缺席不构成反证**。

## 4. 结论对路线的意义

铁律 0.5 说「`OpZkPrecompile` TN12 已 live」—— 这条我现在有了**独立的本地证据**支持（此前是文档陈述）。缺的仍只是 §7 那件：**silverc 发不出这个操作码**，且它是变参，加 builtin 前要先定形。

---
复核：本机 `Get-FileHash` + 字符串扫描；da9 侧 `scratch/j1-remote/kaspadscan.ps1`（只读，从进程实况取 exe 路径，不猜）。