<script>
const STATUS_COLORS = {
  quoted: 'text-slate-400', awaiting_payment: 'text-yellow-400',
  payment_verified: 'text-blue-400', kas_sent: 'text-purple-400',
  completed: 'text-green-400', expired: 'text-slate-600', disputed: 'text-red-400'
};

async function refresh() {
  try {
    const state = await fetch('/api/state').then(r => r.json());
    document.getElementById('buyPrice').textContent = state.quote?.buyPrice ? '$' + state.quote.buyPrice : 'Paused';
    document.getElementById('sellPrice').textContent = state.quote?.sellPrice ? '$' + state.quote.sellPrice : 'Paused';
    document.getElementById('mexcPrice').textContent = state.quote?.mexcPrice ? '$' + state.quote.mexcPrice : '--';
    document.getElementById('kasBalance').textContent = state.kasBalance ? Math.floor(state.kasBalance) + ' KAS' : '--';
    document.getElementById('spread').textContent = state.quote?.spread ? state.quote.spread.toFixed(6) : '--';
    document.getElementById('riskStatus').textContent = state.halted ? 'HALTED' : 'OK';
    document.getElementById('riskStatus').className = 'font-mono ' + (state.halted ? 'text-red-400' : 'text-green-400');
    document.getElementById('canSell').textContent = state.canSell ? 'Yes' : 'No';
    document.getElementById('canSell').className = 'font-mono ' + (state.canSell ? 'text-green-400' : 'text-red-400');
    document.getElementById('canBuy').textContent = state.canBuy ? 'Yes' : 'No';
    document.getElementById('canBuy').className = 'font-mono ' + (state.canBuy ? 'text-green-400' : 'text-red-400');
    document.getElementById('activeOrders').textContent = state.activeOrders || 0;

    if (!document.getElementById('cfgSpread').value) {
      document.getElementById('cfgSpread').value = state.config?.spreadPct || '';
      document.getElementById('cfgMaxOrder').value = state.config?.maxOrderKas || '';
      document.getElementById('cfgMinKas').value = state.config?.minKasReserve || '';
      document.getElementById('cfgHaltPct').value = state.config?.priceDeviationHaltPct || '';
    }
  } catch {}

  try {
    const rep = await fetch('/api/reputation').then(r => r.json());
    document.getElementById('reputation').innerHTML =
      '<div class="flex justify-between"><span class="text-slate-400">Total Orders</span><span class="font-mono">' + (rep.total_orders || 0) + '</span></div>' +
      '<div class="flex justify-between"><span class="text-slate-400">Completed</span><span class="font-mono text-green-400">' + (rep.completed || 0) + '</span></div>' +
      '<div class="flex justify-between"><span class="text-slate-400">Disputes</span><span class="font-mono text-red-400">' + (rep.disputes || 0) + '</span></div>' +
      '<div class="flex justify-between"><span class="text-slate-400">Total Volume</span><span class="font-mono">' + (rep.total_kas_volume || 0) + ' KAS</span></div>' +
      '<div class="flex justify-between"><span class="text-slate-400">Since</span><span class="font-mono">' + (rep.operating_since?.slice(0, 10) || '--') + '</span></div>';
  } catch {}

  try {
    const orders = await fetch('/api/orders').then(r => r.json());
    const tbody = document.getElementById('ordersBody');
    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="px-3 py-6 text-center text-slate-500">No orders yet</td></tr>';
    } else {
      tbody.innerHTML = orders.map(o =>
        '<tr class="hover:bg-slate-700/30">' +
        '<td class="px-3 py-2 text-slate-400 font-mono text-xs">' + (o.created_at?.slice(5, 16) || '') + '</td>' +
        '<td class="px-3 py-2 font-semibold ' + (o.side === 'buy' ? 'text-green-400' : 'text-red-400') + '">' + o.side.toUpperCase() + '</td>' +
        '<td class="px-3 py-2 font-mono">' + o.kas_amount + '</td>' +
        '<td class="px-3 py-2 font-mono">' + o.usdt_amount + '</td>' +
        '<td class="px-3 py-2 font-mono text-blue-400">$' + o.price + '</td>' +
        '<td class="px-3 py-2 uppercase text-xs">' + o.chain + '</td>' +
        '<td class="px-3 py-2 ' + (STATUS_COLORS[o.status] || 'text-slate-400') + '">' + o.status + '</td>' +
        '<td class="px-3 py-2 text-xs text-slate-500">' + (o.batch_total > 1 ? (o.batch_index+1) + '/' + o.batch_total : '-') + '</td>' +
        '</tr>'
      ).join('');
    }
  } catch {}
}

  try {
    const pnl = await fetch('/api/pnl').then(r => r.json());
    const fmt = (v) => v >= 0 ? '+' + v.toFixed(4) : v.toFixed(4);
    const clr = (v) => v >= 0 ? 'text-green-400' : 'text-red-400';
    if (pnl.daily) {
      document.getElementById('pnlDaily').textContent = fmt(pnl.daily.total_profit || 0) + ' USDT';
      document.getElementById('pnlDaily').className = 'text-xl font-bold mt-1 ' + clr(pnl.daily.total_profit || 0);
      document.getElementById('pnlDailyTrades').textContent = (pnl.daily.trades || 0) + ' trades | ' + (pnl.daily.volume_kas || 0) + ' KAS';
    }
    if (pnl.weekly) {
      document.getElementById('pnlWeekly').textContent = fmt(pnl.weekly.total_profit || 0) + ' USDT';
      document.getElementById('pnlWeekly').className = 'text-xl font-bold mt-1 ' + clr(pnl.weekly.total_profit || 0);
      document.getElementById('pnlWeeklyTrades').textContent = (pnl.weekly.trades || 0) + ' trades | ' + (pnl.weekly.volume_kas || 0) + ' KAS';
    }
    if (pnl.monthly) {
      document.getElementById('pnlMonthly').textContent = fmt(pnl.monthly.total_profit || 0) + ' USDT';
      document.getElementById('pnlMonthly').className = 'text-xl font-bold mt-1 ' + clr(pnl.monthly.total_profit || 0);
      document.getElementById('pnlMonthlyTrades').textContent = (pnl.monthly.trades || 0) + ' trades | ' + (pnl.monthly.volume_kas || 0) + ' KAS';
    }
  } catch {}

  try {
    const trades = await fetch('/api/trades').then(r => r.json());
    const tbody = document.getElementById('tradesBody');
    if (trades.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="px-3 py-4 text-center text-slate-500">No trades yet</td></tr>';
    } else {
      tbody.innerHTML = trades.map(t =>
        '<tr class="hover:bg-slate-700/30">' +
        '<td class="px-3 py-2 text-slate-400 font-mono text-xs">' + (t.created_at?.slice(5, 19) || '') + '</td>' +
        '<td class="px-3 py-2 font-semibold ' + (t.side === 'sell' ? 'text-red-400' : 'text-green-400') + '">' + t.side.toUpperCase() + '</td>' +
        '<td class="px-3 py-2 font-mono">' + t.kas_amount + '</td>' +
        '<td class="px-3 py-2 font-mono text-blue-400">$' + t.onchain_price + '</td>' +
        '<td class="px-3 py-2 font-mono text-purple-400">$' + t.exchange_price + '</td>' +
        '<td class="px-3 py-2 font-bold ' + (t.profit_usdt >= 0 ? 'text-green-400' : 'text-red-400') + '">' + (t.profit_usdt >= 0 ? '+' : '') + t.profit_usdt.toFixed(4) + '</td>' +
        '</tr>'
      ).join('');
    }
  } catch {}
}

async function saveExchange() {
  const body = {
    apiKey: document.getElementById('cfgApiKey').value,
    apiSecret: document.getElementById('cfgApiSecret').value,
  };
  await fetch('/api/exchange-config', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  alert('Exchange API saved');
}

async function saveConfig() {
  const body = {
    pricing: { spreadPct: parseFloat(document.getElementById('cfgSpread').value) },
    risk: {
      maxOrderKas: parseInt(document.getElementById('cfgMaxOrder').value),
      minKasReserve: parseInt(document.getElementById('cfgMinKas').value),
      priceDeviationHaltPct: parseFloat(document.getElementById('cfgHaltPct').value),
    }
  };
  await fetch('/api/config', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  alert('Saved');
}

// ── Setup Guide Logic ──
let _selectedAgent = null;

async function connectKanet() {
  const url = document.getElementById('consoleUrl').value.trim();
  const btn = document.getElementById('connectBtn');
  const err = document.getElementById('connectError');
  btn.textContent = 'Connecting...'; btn.disabled = true; err.style.display = 'none';
  try {
    const res = await fetch('/api/connect', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ consoleUrl: url }) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Connection failed');
    const agents = Array.isArray(data.agents) ? data.agents : [];
    if (agents.length === 0) throw new Error('No agents found');
    const list = document.getElementById('agentList');
    list.innerHTML = agents.map(a =>
      '<label class="flex items-center p-3 bg-slate-700 rounded cursor-pointer hover:bg-slate-600 transition-colors">' +
      '<input type="radio" name="agent" value="'+a.id+'" data-name="'+a.name+'" data-addr="'+(a.address||'')+
      '" class="mr-3" '+(agents.length===1?'checked':'')+'/>' +
      '<div><span class="text-white font-medium">'+a.name+'</span>' +
      '<br/><span class="text-xs text-slate-400 font-mono">'+(a.address||'no address')+'</span></div></label>'
    ).join('');
    document.getElementById('step2').style.display = 'block';
    if (agents.length === 1) _selectedAgent = { id: agents[0].id, name: agents[0].name, address: agents[0].address };
    list.addEventListener('change', (e) => {
      const r = e.target; _selectedAgent = { id: r.value, name: r.dataset.name, address: r.dataset.addr };
    });
  } catch (e) {
    err.textContent = e.message; err.style.display = 'block';
  }
  btn.textContent = 'Connect'; btn.disabled = false;
}

async function confirmAgent() {
  if (!_selectedAgent) { alert('Please select an agent'); return; }
  const url = document.getElementById('consoleUrl').value.trim();
  await fetch('/api/save-connection', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ consoleUrl: url, agentId: _selectedAgent.id, agentName: _selectedAgent.name, agentAddress: _selectedAgent.address })
  });
  document.getElementById('setupGuide').style.display = 'none';
  document.getElementById('mainDashboard').style.display = 'block';
  document.getElementById('connInfo').textContent = 'Connected to KANet | Agent: ' + _selectedAgent.name;
  refresh();
  setInterval(refresh, 3000);
}

// Check if already connected
(async () => {
  try {
    const state = await fetch('/api/state').then(r => r.json());
    if (state.connected) {
      document.getElementById('setupGuide').style.display = 'none';
      document.getElementById('mainDashboard').style.display = 'block';
      document.getElementById('connInfo').textContent = 'Connected to KANet | Agent: ' + (state.agentName || '');
      refresh();
      setInterval(refresh, 3000);
    }
  } catch {}
})();
</script>
