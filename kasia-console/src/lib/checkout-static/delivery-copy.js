// delivery-copy.js — 数字商品交付买家页的【全部用户可见文案】集中在此一个表里。
//   ⚠ 全部是【占位文案】(账本1879: 买家页文案先交 Bettor 送 Owner 批, 批之前只用占位跑 simnet)。批准后只改本文件, 逻辑文件不动。
//   🔴 文案红线(v0.4 勘误): 任何一条都不得要求用户把链接/凭据/密文发到第三方; "保存凭据"提示必须说明凭据含秘密、等同于取货与退款的钥匙。
export const COPY = Object.freeze({
  _status: 'PLACEHOLDER — 待 Owner 批准的正式文案替换',
  title: '数字商品取货页(占位)',
  loading: '加载中…',
  loadFailed: (e) => `页面初始化失败: ${e}`,
  noInvoice: '链接里没有订单凭据——请使用商家发给你的完整链接打开。',
  orderBox: { heading: '订单', address: '收款地址', total: '应付总额', deadline: '截止时间', payHint: '请用任意 Kaspa 钱包(含交易所提币)向上面的地址转入应付总额。' },
  credential: { heading: '保存凭据', body: '凭据含秘密, 等同于取货与退款的钥匙。请只保存在你自己的设备上, 不要发给任何人。', button: '下载凭据文件' },
  status: { waitingPayment: '等待付款…', paidWaitingDelivery: '已收到付款, 等待商家交付…', pendingDepth: '交付已发出, 等待链上确认…', delivered: '已交付', readError: (e) => `读取链上状态失败(货在链上不会丢, 稍后自动重试): ${e}` },
  deliverable: { heading: '你的商品', copy: '复制' },
  paste: { heading: '读不到? 粘贴商家发给你的密文', placeholder: '粘贴密文(hex)', button: '本地解密', fail: '无法解密: 密文不属于这个订单或已被改动', ok: '解密成功' },
  refund: { heading: '到期未成交', body: '订单到期且资金仍在订单地址时, 可以触发退款, 资金退回到由你的凭据派生的地址, 再清扫到你自己的地址。', button: '触发退款', notYet: '尚未到期', done: (tx) => `已提交退款交易 ${tx}` },
  sweep: { heading: '清扫', body: '把信箱里暂存的小额资金 / 退款资金转到你自己的地址(在本页内用凭据签名, 私钥不离开浏览器)。', addrLabel: '你的收款地址', mailboxButton: '清扫信箱', refundButton: '清扫退款', nothing: '没有可清扫的资金', sent: (n, tx) => `已提交 ${n} 笔 UTXO 的清扫交易 ${tx}`, badAddr: '地址无效或与订单网络不符' },
});
