# 通讯录合并 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 contacts.eta（通讯录管理）和 audit.eta（链上行为）合并为一个新的通讯录页面，侧栏顶级入口，合并数据源，加快捷发消息框。

**Architecture:** 新建后端 API `/api/contacts/merged` 合并 relation_states + chain_events 数据源。用 audit.eta 的展开式 UI 为基础，融入 contacts.eta 的编辑+添加功能和新的发消息框。侧栏通讯录升为顶级。

**Tech Stack:** Node.js, better-sqlite3, Alpine.js, Eta templates, Tailwind CSS

---

## 文件清单

| 动作 | 文件 | 职责 |
|------|------|------|
| Modify | `kasia-console/src/services/anti-spam.js` | 新增 getMergedContacts() 合并数据源 |
| Modify | `kasia-console/src/index.js` | 新增 /api/contacts/merged API + /audit redirect |
| Rewrite | `kasia-console/src/ui/contacts.eta` | 新通讯录（合并 audit + contacts 功能） |
| Modify | `kasia-console/src/ui/partials/sidebar.eta` | 通讯录升为顶级 + 删 audit 入口 |
| Modify | `kasia-console/src/ui/agent-v2.eta:348` | 跳转链接 /audit → /contacts |

---

### Task 1: 后端 — 合并数据源 API

**Files:**
- Modify: `kasia-console/src/services/anti-spam.js`
- Modify: `kasia-console/src/index.js`

- [ ] **Step 1: 在 anti-spam.js 末尾新增 getMergedContacts()**

在文件末尾（`getOutboundStats` 函数之后）添加：

```javascript
/**
 * 合并通讯录：relation_states ∪ chain_events 取并集
 * 返回每个 peer 的完整信息：身份、行为统计、关系状态
 */
export function getMergedContacts(agentAddress) {
  // 1. 从 chain_events 聚合行为数据（复用 getActivityByPeer 的逻辑）
  const ceStats = getActivityByPeer(agentAddress);
  const ceMap = {};
  for (const s of ceStats) ceMap[s.peer] = s;

  // 2. 从 relation_states 读关系数据
  const relations = sqlite.prepare(`
    SELECT rs.peer_address as peer, rs.status, rs.trust_level, rs.handshake_observed_at, rs.handshake_accepted_at, rs.updated_at,
      i.id as identity_id, i.display_name, i.tags, i.notes, i.card_entity_type, i.card_summary
    FROM relation_states rs
    LEFT JOIN identities i ON i.address = rs.peer_address
    WHERE rs.local_address = ?
  `).all(agentAddress);

  const rsMap = {};
  for (const r of relations) rsMap[r.peer] = r;

  // 3. 合并：取并集
  const allPeers = new Set([...Object.keys(ceMap), ...Object.keys(rsMap)]);
  const isLocal = (addr) => !!sqlite.prepare('SELECT 1 FROM relay_nodes WHERE address = ?').get(addr);

  const merged = [];
  for (const peer of allPeers) {
    const ce = ceMap[peer] || {};
    const rs = rsMap[peer] || {};
    merged.push({
      peer,
      peer_name: ce.peer_name || rs.display_name || null,
      identity_id: ce.identity_id || rs.identity_id || null,
      tags: ce.tags || rs.tags || '',
      notes: ce.notes || rs.notes || '',
      entity_type: rs.card_entity_type || null,
      summary: rs.card_summary || null,
      // 行为统计
      out_count: ce.out_count || 0,
      in_count: ce.in_count || 0,
      total: ce.total || 0,
      unique_total: ce.unique_total || ce.total || 0,
      types: ce.types || '',
      hs_in: ce.hs_in || 0,
      hs_out: ce.hs_out || 0,
      first_ts: ce.first_ts || rs.handshake_observed_at || null,
      last_ts: ce.last_ts || rs.updated_at || null,
      // 关系状态
      status: rs.status || null,
      trust_level: rs.trust_level || 'normal',
      is_local: ce.is_local !== undefined ? ce.is_local : isLocal(peer),
    });
  }

  // 按最近交互排序
  merged.sort((a, b) => (b.last_ts || '').localeCompare(a.last_ts || ''));
  return merged;
}
```

- [ ] **Step 2: 在 index.js 注册 API + audit redirect**

在 index.js 中找到现有的 `/api/agent/activity-by-peer` 路由附近，添加：

```javascript
// 合并通讯录 API
import { getMergedContacts } from './services/anti-spam.js';
// （注意：anti-spam.js 已经在前面 import 过了，只需要在已有的 import 行中加 getMergedContacts）
```

修改已有的 import 行：
```javascript
import { checkOutboundAllowed, getActivityLog, getActivityByPeer, getOutboundStats, detectStopRequest, getMergedContacts } from './services/anti-spam.js';
```

在 `/api/agent/activity-by-peer` 路由之后添加：
```javascript
// 合并通讯录
fastify.get('/api/contacts/merged', async (request, reply) => {
  const { relay_node_id } = request.query;
  if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
  const relayNodes = _listRelayNodes();
  const node = relayNodes.find(r => r.id === relay_node_id);
  if (!node?.address) return reply.code(404).send({ error: 'relay not found' });
  return reply.send(getMergedContacts(node.address));
});
```

修改 `/audit` 路由为 redirect：
```javascript
// /audit → redirect to /contacts
fastify.get('/audit', async (request, reply) => {
  const agent = request.query.agent ? `?agent=${request.query.agent}` : '';
  return reply.redirect(`/contacts${agent}`);
});
```

---

### Task 2: 侧栏 — 通讯录升为顶级

**Files:**
- Modify: `kasia-console/src/ui/partials/sidebar.eta`

- [ ] **Step 1: 通讯录从 Agent 子菜单移到顶级**

将 sidebar.eta 的聊天链接（第 10-13 行）后面、Agent dropdown（第 14 行）前面，插入通讯录顶级入口：

在第 13 行 `</a>` 之后，第 14 行 `<% const _isAgent` 之前，插入：
```html
    <a href="/contacts"
      class="flex items-center px-3 py-2.5 rounded-lg text-sm transition-colors <%= it._page === 'contacts' ? 'bg-brand-50 text-brand-600 font-medium' : 'text-ink-500 hover:bg-warm-100 hover:text-ink-700' %>">
      通讯录
    </a>
```

- [ ] **Step 2: 删除 Agent 子菜单中的通讯录**

删除第 27-30 行（Agent dropdown 里的通讯录链接）：
```html
        <a href="/contacts"
          class="flex items-center px-3 py-1.5 rounded-lg text-xs transition-colors pl-5 <%= it._page === 'contacts' ? 'bg-brand-50 text-brand-600 font-medium' : 'text-ink-400 hover:bg-warm-100 hover:text-ink-600' %>">
          通讯录
        </a>
```

- [ ] **Step 3: 删除设置中的链上行为入口**

删除第 131-134 行（设置区的链上行为链接）：
```html
        <a href="/audit"
          class="flex items-center px-3 py-1.5 rounded-lg text-xs transition-colors pl-5 <%= it._page === 'audit' ? 'bg-brand-50 text-brand-600 font-medium' : 'text-ink-400 hover:bg-warm-100 hover:text-ink-600' %>">
          链上行为
        </a>
```

- [ ] **Step 4: 更新 _isAgent 判断，去掉 contacts**

第 14 行从：
```javascript
<% const _isAgent = ['agent','agent-v2','contacts','story','graph'].includes(it._page); %>
```
改为：
```javascript
<% const _isAgent = ['agent','agent-v2','story','graph'].includes(it._page); %>
```

---

### Task 3: Agent 概览页 — 跳转链接改为 /contacts

**Files:**
- Modify: `kasia-console/src/ui/agent-v2.eta:348`

- [ ] **Step 1: 修改跳转链接**

第 348 行从：
```html
<a :href="'/audit?agent=' + (agent?.id || '')"
```
改为：
```html
<a :href="'/contacts?agent=' + (agent?.id || '')"
```

---

### Task 4: 新通讯录页面

**Files:**
- Rewrite: `kasia-console/src/ui/contacts.eta`

- [ ] **Step 1: 完整重写 contacts.eta**

新页面基于 audit.eta 结构，加入：
- 数据源改为 `/api/contacts/merged`（合并后的）
- 保留 audit 的展开式 UI（联系人列表+点开看行为明细）
- 保留 audit 的标签编辑+备注编辑
- 新增：快捷发消息框（展开联系人后可见）
- 新增：添加联系人按钮+表单
- 保留：排序选择器、筛选、搜索

页面完整代码：

```html
<%~ include('partials/page-open', { _page: 'contacts', pageTitle: '通讯录', ...it }) %>

<div class="p-6" x-data="contactsPage()">
  <!-- 顶栏 -->
  <div class="flex items-center gap-3 mb-3">
    <select x-model="selectedAgent" @change="load()" class="rounded-lg border border-warm-300 px-3 py-2 text-sm bg-white font-medium">
      <% it.relayNodes.forEach(r => { %>
      <option value="<%= r.id %>"><%= r.name %></option>
      <% }) %>
    </select>
    <span class="text-sm text-ink-700" x-show="!loading" x-text="contacts.length + ' 个联系人'"></span>
    <button @click="showAdd = !showAdd" class="btn btn-primary btn-sm ml-auto">
      <span x-text="showAdd ? '收起' : '+ 添加'"></span>
    </button>
  </div>

  <!-- 添加联系人（折叠） -->
  <div x-show="showAdd" x-transition class="card mb-4">
    <div class="grid grid-cols-3 gap-3">
      <div>
        <label class="block text-xs text-ink-400 mb-1">地址 *</label>
        <input type="text" x-model="addForm.address" placeholder="kaspa:qr..." class="w-full text-sm border border-warm-300 rounded-lg px-3 py-2 font-mono" />
      </div>
      <div>
        <label class="block text-xs text-ink-400 mb-1">名称</label>
        <input type="text" x-model="addForm.display_name" class="w-full text-sm border border-warm-300 rounded-lg px-3 py-2" />
      </div>
      <div>
        <label class="block text-xs text-ink-400 mb-1">信任等级</label>
        <select x-model="addForm.trust_level" class="w-full text-sm border border-warm-300 rounded-lg px-3 py-2">
          <option value="normal">普通</option>
          <option value="recommended">推荐</option>
          <option value="blocked">屏蔽</option>
        </select>
      </div>
    </div>
    <div class="flex justify-end mt-3">
      <button @click="addContact()" class="btn btn-primary btn-sm" :disabled="!addForm.address?.trim()">保存</button>
    </div>
  </div>

  <!-- 筛选+排序 -->
  <div class="flex items-center gap-2 mb-4 flex-wrap">
    <button @click="scope='all'" class="btn btn-sm" :class="scope==='all' ? 'btn-primary' : 'btn-ghost'">全部</button>
    <button @click="scope='external'" class="btn btn-sm" :class="scope==='external' ? 'btn-primary' : 'btn-ghost'"
      x-text="'外部 (' + contacts.filter(p=>!p.is_local).length + ')'"></button>
    <button @click="scope='internal'" class="btn btn-sm" :class="scope==='internal' ? 'btn-primary' : 'btn-ghost'"
      x-text="'内部 (' + contacts.filter(p=>p.is_local).length + ')'"></button>
    <span class="text-[10px] text-ink-300 ml-2">排序:</span>
    <select x-model="sortBy" class="text-xs border border-warm-300 rounded px-2 py-1 bg-white">
      <option value="recent">最近交互</option>
      <option value="total">交互最多</option>
      <option value="out">发出最多</option>
      <option value="name">名称</option>
    </select>
    <input x-model="search" placeholder="搜索..." class="ml-2 text-xs border border-warm-300 rounded-lg px-3 py-1.5 w-40" />
  </div>

  <div x-show="loading" class="text-center text-ink-300 py-16">加载中...</div>

  <!-- 联系人列表 -->
  <div x-show="!loading" class="space-y-1">
    <template x-for="p in sorted" :key="p.peer">
      <div class="border border-warm-200 rounded-xl overflow-hidden" :class="p.is_local ? 'bg-white' : 'bg-amber-50/30'">
        <!-- 摘要行 -->
        <div class="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-warm-50 transition-colors"
          @click="toggle(p.peer)">
          <span class="badge text-[9px] w-8 text-center flex-shrink-0" :class="p.is_local ? 'badge-info' : 'badge-warning'" x-text="p.is_local ? '内部' : '外部'"></span>
          <div class="w-40 flex-shrink-0">
            <div class="text-sm font-medium text-ink-700 truncate" x-text="p.peer_name || '未命名'"></div>
            <div class="text-[10px] text-ink-300 font-mono" x-text="shortAddr(p.peer)"></div>
          </div>
          <div class="flex gap-0.5 flex-shrink-0 max-w-28 overflow-hidden">
            <template x-for="t in (p.tags||'').split(',').filter(Boolean).slice(0,3)" :key="t">
              <span class="badge badge-neutral text-[8px]" x-text="t"></span>
            </template>
          </div>
          <template x-if="p.hs_out > 0 && (p.hs_in || 0) === 0">
            <span class="badge badge-warning text-[8px]">发起中</span>
          </template>
          <template x-if="p.status && !p.is_local">
            <span class="badge text-[8px]" :class="p.status==='active'?'badge-success':p.status==='accepted'?'badge-info':'badge-neutral'" x-text="p.status"></span>
          </template>
          <span class="text-xs text-blue-600 w-12 flex-shrink-0" x-text="'↑' + p.out_count"></span>
          <span class="text-xs text-green-600 w-12 flex-shrink-0" x-text="'↓' + p.in_count"></span>
          <span class="text-xs font-bold text-ink-700 w-14 flex-shrink-0" x-text="'Σ' + (p.unique_total || p.total)"></span>
          <span class="text-[10px] text-ink-300 ml-auto flex-shrink-0" x-text="p.last_ts?.slice(5,16)?.replace('T',' ') || '-'"></span>
          <span class="text-ink-300 text-[10px]" x-text="expanded===p.peer ? '▼' : '▶'"></span>
        </div>

        <!-- 展开详情 -->
        <template x-if="expanded===p.peer">
          <div class="border-t border-warm-200">
            <!-- 信息栏 -->
            <div class="px-4 py-2.5 bg-warm-100/50 border-b border-warm-100 space-y-1.5">
              <div class="flex items-center gap-2">
                <span class="text-[10px] text-ink-400">地址:</span>
                <span class="text-[10px] text-ink-600 font-mono break-all cursor-copy select-all" @click="navigator.clipboard.writeText(p.peer)" title="点击复制" x-text="p.peer"></span>
              </div>
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-[10px] text-ink-400">标签:</span>
                <template x-for="t in (p.tags||'').split(',').filter(Boolean)" :key="t">
                  <span class="badge badge-neutral text-[9px]" x-text="t"></span>
                </template>
                <input x-model="editTag" placeholder="+ 添加" @keydown.enter.prevent="saveTag(p)" class="text-[10px] border border-warm-300 rounded px-2 py-0.5 w-20 bg-white" />
                <button @click="saveTag(p)" class="btn btn-primary btn-sm text-[10px] py-0" x-show="editTag.trim()">加</button>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] text-ink-400">备注:</span>
                <span class="text-[10px] text-ink-500" x-text="p.notes || '无'" x-show="!editingNote"></span>
                <input x-show="editingNote" x-model="editNote" @keydown.enter.prevent="saveNote(p)" class="text-[10px] border border-warm-300 rounded px-2 py-0.5 flex-1 bg-white" />
                <button @click="editingNote ? saveNote(p) : (editingNote=true, editNote=p.notes||'')" class="text-[10px] text-brand-600 hover:text-brand-700 cursor-pointer" x-text="editingNote ? '保存' : '编辑'"></button>
              </div>
            </div>
            <!-- 快捷发消息 -->
            <div class="flex items-center gap-2 px-4 py-2 bg-brand-50/30 border-b border-warm-100">
              <input x-model="quickMsg" placeholder="发送消息..." @keydown.enter.prevent="sendMsg(p)"
                class="flex-1 text-xs border border-warm-300 rounded-lg px-3 py-1.5 bg-white" />
              <button @click="sendMsg(p)" class="btn btn-primary btn-sm text-[10px]" :disabled="!quickMsg.trim() || sending">
                <span x-text="sending ? '发送中...' : '发送'"></span>
              </button>
            </div>
            <!-- 分页 -->
            <div class="flex items-center gap-2 px-4 py-1.5 bg-warm-50 border-b border-warm-100">
              <button @click="detailPage=Math.max(1,detailPage-1); loadDetail(p.peer)" :disabled="detailPage<=1" class="btn btn-ghost btn-sm text-[10px]">&lt;</button>
              <span class="text-[10px] text-ink-400" x-text="'第' + detailPage + '页'"></span>
              <button @click="detailPage++; loadDetail(p.peer)" :disabled="detailEvents.length < detailPageSize" class="btn btn-ghost btn-sm text-[10px]">&gt;</button>
              <select x-model.number="detailPageSize" @change="detailPage=1; loadDetail(p.peer)" class="text-[10px] border border-warm-300 rounded px-1.5 py-0.5 bg-white">
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
            <!-- 行为明细 -->
            <div x-show="detailLoading" class="text-center text-ink-300 py-6 text-xs">加载中...</div>
            <div class="divide-y divide-warm-100 max-h-[500px] overflow-y-auto">
              <template x-for="(e, i) in detailEvents" :key="i">
                <div class="px-4 py-2 text-xs" :class="e.dir==='out' ? 'bg-blue-50/30' : ''">
                  <div class="flex gap-2 items-start">
                    <span class="w-5 flex-shrink-0 font-bold" :class="e.dir==='out' ? 'text-blue-500' : 'text-green-500'" x-text="e.dir==='out' ? '→' : '←'"></span>
                    <span class="w-28 flex-shrink-0 text-ink-400 font-mono" x-text="e.ts?.slice(5,19)?.replace('T',' ')"></span>
                    <span class="badge badge-neutral text-[8px] flex-shrink-0" x-text="e.type"></span>
                    <div class="flex-1 min-w-0">
                      <template x-if="e.content">
                        <div class="text-ink-600 whitespace-pre-wrap break-words" x-text="e.content"></div>
                      </template>
                      <template x-if="!e.content && e.txid">
                        <div class="font-mono text-ink-300 break-all text-[10px]" x-text="'tx: ' + e.txid"></div>
                      </template>
                      <template x-if="!e.content && !e.txid">
                        <span class="text-ink-300">—</span>
                      </template>
                    </div>
                  </div>
                </div>
              </template>
            </div>
            <div x-show="!detailLoading && detailEvents.length===0" class="text-center text-ink-300 py-4 text-xs">无记录</div>
          </div>
        </template>
      </div>
    </template>
  </div>
</div>

<script>
function contactsPage() {
  return {
    selectedAgent: new URLSearchParams(location.search).get('agent') || '<%= it.relayNodes[0]?.id || '' %>',
    contacts: [],
    loading: true,
    scope: 'all',
    search: '',
    sortBy: 'recent',
    expanded: null,
    detailEvents: [],
    detailLoading: false,
    detailPage: 1,
    detailPageSize: 50,
    editTag: '',
    editNote: '',
    editingNote: false,
    quickMsg: '',
    sending: false,
    showAdd: false,
    addForm: { address: '', display_name: '', trust_level: 'normal' },

    shortAddr(addr) {
      if (!addr || addr.length < 30) return addr;
      return addr.slice(0, 12) + '...' + addr.slice(-12);
    },

    get filtered() {
      let list = this.contacts;
      if (this.scope === 'external') list = list.filter(p => !p.is_local);
      else if (this.scope === 'internal') list = list.filter(p => p.is_local);
      if (this.search) {
        const q = this.search.toLowerCase();
        list = list.filter(p => (p.peer||'').includes(q) || (p.peer_name||'').toLowerCase().includes(q) || (p.tags||'').includes(q));
      }
      return list;
    },

    get sorted() {
      const list = [...this.filtered];
      switch (this.sortBy) {
        case 'recent': return list.sort((a, b) => (b.last_ts||'').localeCompare(a.last_ts||''));
        case 'total': return list.sort((a, b) => (b.unique_total||b.total) - (a.unique_total||a.total));
        case 'out': return list.sort((a, b) => b.out_count - a.out_count);
        case 'name': return list.sort((a, b) => (a.peer_name||'zzz').localeCompare(b.peer_name||'zzz'));
        default: return list;
      }
    },

    async toggle(addr) {
      if (this.expanded === addr) { this.expanded = null; return; }
      this.expanded = addr;
      this.detailPage = 1;
      this.editTag = '';
      this.editingNote = false;
      this.quickMsg = '';
      await this.loadDetail(addr);
    },

    async loadDetail(addr) {
      this.detailLoading = true;
      try {
        const offset = (this.detailPage - 1) * this.detailPageSize;
        const res = await fetch('/api/agent/activity-log?relay_node_id=' + this.selectedAgent +
          '&peer_address=' + encodeURIComponent(addr) +
          '&limit=' + this.detailPageSize + '&offset=' + offset);
        this.detailEvents = await res.json();
      } catch { this.detailEvents = []; }
      this.detailLoading = false;
    },

    async saveTag(p) {
      if (!this.editTag.trim() || !p.identity_id) return;
      const newTags = p.tags ? p.tags + ',' + this.editTag.trim() : this.editTag.trim();
      await fetch('/api/contacts/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.identity_id, tags: newTags }),
      });
      p.tags = newTags;
      this.editTag = '';
    },

    async saveNote(p) {
      if (!p.identity_id) return;
      await fetch('/api/contacts/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.identity_id, notes: this.editNote }),
      });
      p.notes = this.editNote;
      this.editingNote = false;
    },

    async sendMsg(p) {
      if (!this.quickMsg.trim()) return;
      this.sending = true;
      try {
        await fetch('/api/relay/' + this.selectedAgent + '/send-command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'send_message', target: p.peer, message: this.quickMsg.trim() }),
        });
        this.quickMsg = '';
        // 刷新明细看到刚发的消息
        setTimeout(() => this.loadDetail(p.peer), 2000);
      } catch (e) { console.error('send failed:', e); }
      this.sending = false;
    },

    async addContact() {
      if (!this.addForm.address?.trim()) return;
      await fetch('/api/contacts/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.addForm),
      });
      this.addForm = { address: '', display_name: '', trust_level: 'normal' };
      this.showAdd = false;
      await this.load();
    },

    async init() { await this.load(); },

    async load() {
      this.loading = true;
      this.expanded = null;
      try {
        const res = await fetch('/api/contacts/merged?relay_node_id=' + this.selectedAgent);
        this.contacts = await res.json();
      } catch { this.contacts = []; }
      this.loading = false;
    },
  };
}
</script>

<%~ include('partials/page-close', it) %>
```

---

### Task 5: 测试验证

- [ ] **Step 1: 重启系统**

```bash
cd D:/Anthropic && bash kanet-stop.sh && bash kanet-start.sh
```

- [ ] **Step 2: 验证 merged API 数据量**

```bash
# 对比合并前后数量
curl -s "http://127.0.0.1:3100/api/contacts/merged?relay_node_id=3765cc82-5e20-4e61-bb0a-697277287223" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
console.log('合并后联系人:', d.length);
console.log('有行为数据:', d.filter(c=>c.total>0).length);
console.log('仅关系无行为:', d.filter(c=>c.total===0).length);
"
```

预期：合并后 ≥ 40（Martin 的 relation_states 数）

- [ ] **Step 3: 验证页面渲染**

```bash
curl -s http://127.0.0.1:3100/contacts | grep -c "contactsPage\|通讯录\|quickMsg\|sendMsg\|addContact"
```

预期：≥ 5

- [ ] **Step 4: 验证 /audit redirect**

```bash
curl -s -o /dev/null -w "%{redirect_url}" http://127.0.0.1:3100/audit
```

预期：包含 `/contacts`

- [ ] **Step 5: 验证侧栏**

```bash
# 通讯录在聊天后面、Agent 前面
curl -s http://127.0.0.1:3100/contacts | grep -A2 "聊天" | grep "通讯录"
```

- [ ] **Step 6: 人工验收**

1. 打开 http://127.0.0.1:3100/contacts
2. 确认联系人列表数量 ≥ 旧通讯录和旧链上行为的最大值
3. 点开一个联系人，确认能看到行为明细
4. 编辑标签，刷新确认持久化
5. 在快捷发消息框输入消息，点发送
6. 手动添加一个联系人
7. 访问 /audit → 确认 redirect 到 /contacts
8. 侧栏"通讯录"在聊天下面、Agent 上面
