/**
 * Chain Events — event_type 枚举
 *
 * 所有写入 chain_events 表的 event_type 值必须在这里定义。
 * anti-spam 等读取方也从这里引用，确保写入和查询对齐。
 *
 * 新增 event_type 时：
 * 1. 在下面加常量
 * 2. 如果是社交类（会触发 anti-spam 检查），加到 SOCIAL_EVENT_TYPES
 * 3. 如果是交易类，加到 TRADE_EVENT_TYPES
 */

// ── 社交类 ──
export const HANDSHAKE = 'handshake';
export const TEXT = 'text';              // DM 消息（ingest-service 默认 messageType）
export const COMM = 'comm';              // comm 类型消息
export const COMM_SENT = 'comm_sent';    // Agent 发广播（chat.js）
export const COMM_RECEIVED = 'comm_received';

// ── 交易类 ──
export const TX = 'tx';
export const PAYMENT = 'payment';
export const PAYMENT_FAILED = 'payment_failed';
export const PAYMENT_VERIFIED = 'payment_verified';
export const PAYMENT_UNDERPAYMENT = 'payment_underpayment';
export const KAS_DELIVERY = 'kas_delivery';
export const KAS_DELIVERY_FAILED = 'kas_delivery_failed';
export const VERIFY_FAILED = 'verify_failed';
export const WITHDRAW = 'withdraw';

// ── 集合（供查询方使用）──

/** anti-spam 检查的社交事件类型（必须涵盖所有 outbound 消息类型） */
export const SOCIAL_EVENT_TYPES = [HANDSHAKE, TEXT, COMM, COMM_SENT];

/** anti-spam 检查的 outbound 发送类型 */
export const OUTBOUND_SEND_TYPES = [COMM, COMM_SENT, TEXT];

/** anti-spam 检查的 inbound 回复类型 */
export const INBOUND_REPLY_TYPES = [COMM, COMM_RECEIVED, TEXT];

/** 交易失败类型（agent-health 查询用） */
export const TRADE_FAIL_TYPES = [PAYMENT_FAILED, KAS_DELIVERY_FAILED, VERIFY_FAILED];
