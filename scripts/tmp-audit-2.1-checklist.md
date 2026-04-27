# TASK 2.1 审核清单 (我跑的, 不是 QClaude 自测)

## 文件只能改 retail-dex.js
- [ ] git diff --name-only HEAD 只显示 kasia-console/src/services/retail-dex.js
- [ ] 没有新建其他文件 (smoke 脚本允许在 /tmp)

## 关 1 静态深审
- [ ] node --check retail-dex.js PASS
- [ ] wc -l 实际行数 vs QClaude 汇报差值 ≤ 5
- [ ] grep 'agent-mind\|mind-manager\|adapter\|brain' 返空
- [ ] selectBestOffer 在 export { ... } 块里
- [ ] computeQuote 签名真的是 (order, offer, brokerRelayId)
- [ ] getSpread 函数体从文件消失 (grep 'function getSpread' / 'getSpread(' 除 export 外返空)
- [ ] getAgentWalletAddr 函数体还在 (留着给其他地方用)

## 关 2 computeQuote 逻辑
- [ ] 不查 agent_wallets (grep 'agent_wallets' 返空 或只在不相关函数)
- [ ] 读 offer.verification_meta JSON parse
- [ ] 兼容 verification_meta 为 null/空/非法 JSON
- [ ] normalizeChain 调用对齐 accepted_chains[i].chain (小写对比)
- [ ] quoted_usdt = offer.want_amount (不是 qty*mid*(1+spread))
- [ ] 无 spread 参数残留
- [ ] 返回字段含 maker_pay_addr, offer_id, give_amount

## 关 3 selectBestOffer 逻辑
- [ ] SQL 里 protocol_status='open' AND give_asset='KAS' AND want_asset='USDT'
- [ ] 精确 give_amount = qty 优先, 然后 fallback
- [ ] ORDER BY want/give ASC (买家要最便宜)
- [ ] expires_at > now 过滤
- [ ] JS 层 accepted_chains 包含用户链 过滤
- [ ] 无匹配返 null (不 throw)

## 关 4 回归 (不跑, 确认 DONE 里明说 handleDm broken)
- [ ] DONE 消息里明确 "handleDm 编译失败符合 2.1 预期, 2.2 修"

## 关 5 smoke 脚本独立跑
- [ ] 我在自己机器上跑一次 QClaude 写的 smoke-2.1.mjs (不是依赖 QClaude 自测)
- [ ] 12 case 全绿
- [ ] case 5 (verification_meta 非法 JSON) 不 throw
- [ ] case 11 (过期 offer) 真跳过
- [ ] case 12 (status=matched) 真跳过

## 独立构造攻击测试 (我加的, 超 QClaude 声明之外)
- [ ] offer.verification_meta = undefined (非 null) → 不崩
- [ ] accepted_chains[i].chain 是大写 → 归一化后仍匹配 (小写对比)
- [ ] 两个 offer 同 qty 不同价 → 选便宜的
- [ ] SQL 注入测试: order.qty = "1'; DROP TABLE--" → prepare 拦住

## 验证通过后
- [ ] post `[→ QCLAUDE-NWT] [AUDIT PASS TASK 2.1]` 到 dev-coord
- [ ] 附 TASK 2.2 spec
