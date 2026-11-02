/* 賽馬熱錢流 — Phase 0 monitor. No dependencies, no build step. */
'use strict';

const state = {
  summary: null,
  mid: null,
  race: null,
  meeting: null,
  timer: null,
  ageTimer: null,
  sort: 'stake',
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

/* ---------------------------------------------------------------- formatting */
const nf = new Intl.NumberFormat('en-US');
const money = (v) => (v === null || v === undefined || v === 0 ? '—' : nf.format(Math.round(v)));
const pct = (v) => (v === null || v === undefined ? '—' : (v * 100).toFixed(1) + '%');
const hhmm = (iso) => {
  if (!iso) return '—';
  const m = String(iso).match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '—';
};
const secs = (iso) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 1000));
};
const ageText = (s) => (s === null ? '—' : s < 90 ? `${s}s 前` : s < 5400 ? `${Math.round(s / 60)} 分鐘前` : `${(s / 3600).toFixed(1)} 小時前`);
const big = (v) => {
  if (!v) return '—';
  if (v >= 1e8) return (v / 1e8).toFixed(2) + ' 億';
  if (v >= 1e4) return (v / 1e4).toFixed(0) + ' 萬';
  return nf.format(Math.round(v));
};
const countdown = (iso) => {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  let d = Math.round((t - Date.now()) / 1000);
  if (d < 0) return '已開跑';
  const h = Math.floor(d / 3600), m = Math.floor((d % 3600) / 60), s = d % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m${String(s).padStart(2, '0')}s`;
};
const delta = (cur, prev) => {
  if (cur === null || prev === null || cur === undefined || prev === undefined) return '';
  const d = cur - prev;
  if (!d) return '';
  const cls = d > 0 ? 'up' : 'down';
  return `<span class="${cls}">${d > 0 ? '+' : ''}${nf.format(Math.round(d))}</span>`;
};

/* --------------------------------------------------------------------- fetch */
const STATIC = window.MF_STATIC || null;   // GitHub Pages snapshot mode

async function api(path) {
  if (STATIC) {
    if (path === 'api/summary') return STATIC.summary;
    const m = path.match(/^api\/meeting\/(.+)$/);
    if (m) {
      const mid = decodeURIComponent(m[1]);
      return STATIC.meetings[mid] || { error: 'meeting not in snapshot' };
    }
    return {};
  }
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}

async function refresh() {
  try {
    const s = await api('api/summary');
    state.summary = s;
    if (!state.mid && s.meetings.length) {
      const withSale = s.meetings.find((m) => m.sale_open) || null;
      state.mid = (withSale || s.meetings[s.meetings.length - 1]).id;
    }
    if (state.mid) {
      state.meeting = await api('api/meeting/' + encodeURIComponent(state.mid));
      const races = state.meeting.races || [];
      const cur = state.meeting.cur_race || 0;
      if (!state.race || !races.some((r) => r.no === state.race)) {
        state.race = races.some((r) => r.no === cur) ? cur : (races[0] ? races[0].no : null);
      }
    }
    render();
  } catch (e) {
    $('#age').textContent = '連線失敗';
    console.error(e);
  }
}

/* --------------------------------------------------------------------- render */
function render() {
  renderHealth();
  renderPills();
  renderCards();
  renderRaces();
  renderChart();
  renderDist();
  renderHot();
  renderPools();
  renderRunners();
  $('#boot').textContent = STATIC
    ? '靜態快照 · 由本機 collector 產生（GitHub Pages）'
    : `updated ${new Date().toLocaleTimeString('zh-HK', { hour12: false })} · api /api/summary`;
}

function renderHealth() {
  const h = state.summary?.health || {};
  if (STATIC) {
    document.querySelectorAll('.dot').forEach((d) => { d.className = 'dot ok'; });
    $('#age').textContent = `快照 ${String(STATIC.summary.now || '').replace('T', ' ').slice(5, 16)}`;
    return;
  }
  document.querySelectorAll('.dot').forEach((d) => {
    const ok = d.dataset.k === 'collector' ? h.collector : h.mqtt;
    d.className = 'dot ' + (ok ? 'ok' : 'bad');
  });
  $('#age').textContent = h.last_poll_age_s !== null && h.last_poll_age_s !== undefined
    ? `資料 ${ageText(h.last_poll_age_s)}` : '—';
}

function renderPills() {
  const nav = $('#meetings');
  nav.innerHTML = '';
  (state.summary?.meetings || []).forEach((m) => {
    const b = el('button', 'pill' + (m.id === state.mid ? ' on' : ''));
    b.innerHTML = `${m.date.slice(5)} ${m.venue}<span class="v">${m.sale_open ? '開售' : (m.status || '—')}</span>`;
    b.onclick = () => { state.mid = m.id; state.race = null; refresh(); };
    nav.appendChild(b);
  });
}

function renderCards() {
  const m = state.meeting;
  const cards = $('#cards');
  cards.innerHTML = '';
  if (!m) { cards.appendChild(el('div', 'card stat', '<div class="k">等待資料</div><div class="v">—</div>')); return; }

  const series = m.series?.total || [];
  const last = series.length ? series[series.length - 1][1] : m.total_inv;
  let ref = null;
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (let i = series.length - 1; i >= 0; i--) {
    if (Date.parse(series[i][0]) <= cutoff) { ref = series[i][1]; break; }
  }
  const flow = (last !== null && ref !== null) ? last - ref : null;

  const race = currentRace();
  const pool = race ? race.win_pool : null;
  const open = m.sale_open ? hhmm(m.sale_open) + ' 開售' : '未開售';

  const items = [
    { k: '賽事總投注額', v: big(last), s: `${m.races.length} 場 · ${m.pools.length} 個彩池` },
    { k: `第 ${race ? race.no : '—'} 場 WIN 池`, v: big(pool), s: race ? `${race.dist}m ${race.track || ''} ${race.cls || ''}` : '' },
    { k: '5 分鐘流入', v: flow === null ? '—' : (flow >= 0 ? '+' : '') + big(Math.abs(flow)), s: flow === null ? '未有兩個時間點' : '全場合計', cls: flow > 0 ? 'up' : '' },
    { k: '開售狀態', v: m.sale_open ? '開售中' : (m.status || '—'), s: open, cls: m.sale_open ? 'gold' : '' },
  ];
  items.forEach((it) => {
    const c = el('div', 'card stat');
    c.innerHTML = `<div class="k">${it.k}</div><div class="v ${it.cls || ''}">${it.v}</div><div class="s">${it.s || ''}</div>`;
    cards.appendChild(c);
  });
}

function currentRace() {
  if (!state.meeting) return null;
  return (state.meeting.races || []).find((r) => r.no === state.race) || null;
}

function renderRaces() {
  const m = state.meeting;
  const tabs = $('#race-tabs');
  tabs.innerHTML = '';
  if (!m) { $('#meeting-title').textContent = '—'; return; }
  $('#meeting-title').textContent = `${m.date} ${m.venue} · ${m.status || ''}`;
  const race = currentRace();
  $('#meeting-meta').textContent = race
    ? `${race.name || ''} ${race.dist || ''}m ${race.track || ''} · ${race.n_runners || 0} 匹 · 開跑 ${hhmm(race.post_time)}（${countdown(race.post_time)}）`
    : '';
  (m.races || []).forEach((r) => {
    const b = el('button', 'rtab' + (r.no === state.race ? ' on' : ''));
    b.innerHTML = `R${r.no}<span class="t">${hhmm(r.post_time)}</span>`;
    b.onclick = () => { state.race = r.no; render(); };
    tabs.appendChild(b);
  });
}

/* ---------------------------------------------------------------------- chart */
function renderChart() {
  const box = $('#chart');
  const m = state.meeting;
  if (!m) { box.innerHTML = '<div class="empty">等緊數據…</div>'; return; }
  const total = (m.series?.total || []).map(([ts, v]) => [Date.parse(ts), v]);
  const win = ((m.series?.win || {})[String(state.race)] || []).map(([ts, v]) => [Date.parse(ts), v]);
  const lines = [];
  if (total.length > 1) lines.push({ pts: total, color: '#4aa3ff', label: '全場投注額' });
  if (win.length > 1) lines.push({ pts: win, color: '#f0c674', label: `R${state.race} WIN 池` });
  $('#legend').innerHTML = lines.map((l) => `<span><i style="background:${l.color}"></i>${l.label}</span>`).join('');
  if (!lines.length) {
    box.innerHTML = '<div class="empty">未有走勢（未開售或只有一個時間點）</div>';
    return;
  }
  const W = 900, H = 260, P = { l: 54, r: 12, t: 12, b: 22 };
  const xs = lines.flatMap((l) => l.pts.map((p) => p[0]));
  const ys = lines.flatMap((l) => l.pts.map((p) => p[1] ?? 0));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y0 === y1) { y0 = 0; y1 = Math.max(1, y1 * 1.2); }
  const pad = (y1 - y0) * 0.08;
  y0 = Math.max(0, y0 - pad); y1 = y1 + pad;
  const X = (t) => P.l + ((t - x0) / Math.max(1, x1 - x0)) * (W - P.l - P.r);
  const Y = (v) => H - P.b - ((v - y0) / (y1 - y0)) * (H - P.t - P.b);

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = y0 + (y1 - y0) * (1 - f);
    const y = P.t + (H - P.t - P.b) * f;
    return `<line class="grid-line" x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}"/>` +
      `<text x="${P.l - 8}" y="${y + 3}" text-anchor="end">${big(v)}</text>`;
  }).join('');

  const paths = lines.map((l) => {
    const d = l.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1] ?? 0).toFixed(1)}`).join('');
    return `<path d="${d}" fill="none" stroke="${l.color}" stroke-width="1.8" stroke-linejoin="round"/>`;
  }).join('');

  const tl = [x0, x0 + (x1 - x0) / 2, x1].map((t) => {
    const d = new Date(t + 8 * 3600e3);
    return `<text x="${X(t)}" y="${H - 6}" text-anchor="middle">${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}</text>`;
  }).join('');

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}${paths}${tl}</svg>`;
}

/* ------------------------------------------------------- money distribution */
const SEG = [
  ['win', '#4aa3ff'],
  ['pla', '#35d0a5'],
  ['qin', '#f0c674'],
  ['qpl', '#b06cff'],
];

function renderDist() {
  const box = $('#dist-chart');
  const race = currentRace();
  const d = race?.dist;
  if (!d || !d.horses || !d.horses.length || !d.total) {
    $('#dist-title').textContent = '即時熱錢分佈';
    box.innerHTML = '<div class="empty">未開售 — 未有資金分佈</div>';
    return;
  }
  const title = `R${race.no} 即時熱錢分佈 <b>${nf.format(Math.round(d.total))}</b>`;
  const since = d.since ? `<span class="dist-meta">對比 ${hhmm(d.since)}</span>` : '';
  $('#dist-title').innerHTML = title + since;

  const max = Math.max(...d.horses.map((h) => h.total), 1);
  const H = 220;
  const rank = new Map(d.horses.map((h, i) => [h.no, i]));
  box.innerHTML = '';
  d.horses.forEach((h) => {
    const col = el('div', 'dcol');
    const segs = SEG.map(([k, color]) => {
      const v = h[k] || 0;
      if (!v) return '';
      const px = Math.max(1, (v / max) * H);
      return `<i style="height:${px.toFixed(1)}px;background:${color}" title="${color} HK$${nf.format(Math.round(v))}"></i>`;
    }).join('');
    const r = rank.get(h.no);
    const cls = r < 3 ? 'hot' : r < 6 ? 'warm' : 'cool';
    const dv = h.delta;
    const dl = dv === null || dv === undefined ? '' :
      `<div class="dl ${dv >= 0 ? 'up' : 'down'}">${dv >= 0 ? '+' : ''}${big(Math.abs(dv))}</div>`;
    col.innerHTML = `
      <div class="badge ${cls}">${h.no}</div>
      <div class="stack" style="height:${H}px;justify-content:flex-end">${segs}</div>
      <div class="amt">${big(h.total)}</div>
      <div class="od">${h.odds ? h.odds.toFixed(1) : '—'}</div>
      ${dl}`;
    col.title = `${h.no} ${h.name || ''} ${h.jockey || ''}\nWIN ${money(h.win)} · PLA ${money(h.pla)}\nQIN ${money(h.qin)} · QPL ${money(h.qpl)}\n合計 ${money(h.total)}（${pct(h.share)}）`;
    box.appendChild(col);
  });
}

/* -------------------------------------------------------------------- hotlist */
function renderHot() {
  const box = $('#hotlist');
  const race = currentRace();
  const rows = (race?.runners || []).filter((r) => r.odds);
  if (!rows.length) {
    box.innerHTML = '<div class="empty">未開售 — 賠率／資金未出現</div>';
    return;
  }
  const sorted = [...rows].sort((a, b) => (b.stake || 0) - (a.stake || 0)).slice(0, 6);
  const max = Math.max(...sorted.map((r) => r.stake || r.share || 0), 1);
  box.innerHTML = '';
  sorted.forEach((r) => {
    const amt = r.stake || 0;
    const dv = (r.odds_prev && r.odds) ? r.odds - r.odds_prev : null;
    const row = el('div', 'hot');
    row.innerHTML = `
      <div class="n">${r.no}</div>
      <div class="nm">
        <b>${r.name || ''}</b>
        <div class="bar ${dv !== null && dv < 0 ? 'hot' : ''}"><i style="width:${Math.max(2, (amt / max) * 100)}%"></i></div>
        <small>${r.jockey || ''} · ${r.odds ? r.odds.toFixed(1) : '—'} 倍${r.drop ? ` · 落飛 ${r.drop.toFixed(1)}` : ''}${dv !== null && dv !== 0 ? ` · <span class="${dv < 0 ? 'up' : 'down'}">${dv > 0 ? '+' : ''}${dv.toFixed(1)}</span>` : ''}</small>
      </div>
      <div class="amt">${amt ? big(amt) : pct(r.share)}</div>`;
    box.appendChild(row);
  });
}

/* ---------------------------------------------------------------------- pools */
function renderPools() {
  const m = state.meeting;
  const tbody = $('#pools tbody');
  tbody.innerHTML = '';
  const pools = (m?.pools || []).slice().sort((a, b) => {
    if (a.type === 'WIN') return -1;
    if (b.type === 'WIN') return 1;
    return (b.inv || 0) - (a.inv || 0);
  }).slice(0, 60);
  $('#pool-count').textContent = `${m?.pools.length || 0} 個`;
  if (!pools.length) { tbody.innerHTML = '<tr><td colspan="5" class="muted">未有彩池資料</td></tr>'; return; }
  pools.forEach((p) => {
    const tr = el('tr');
    const sell = (p.sell || '').toUpperCase();
    const open = sell && !['STOP_SELL', 'CLOSED', 'SUSPENDED', ''].includes(sell);
    tr.innerHTML = `
      <td>${p.type}</td>
      <td class="muted">${p.leg || ''}</td>
      <td class="num">${money(p.inv)}</td>
      <td class="num">${delta(p.inv, p.prev_inv)}</td>
      <td class="sell ${open ? 'open' : ''}">${sell || '—'}</td>`;
    tbody.appendChild(tr);
  });
}

/* -------------------------------------------------------------------- runners */
function renderRunners() {
  const race = currentRace();
  const tbody = $('#runners tbody');
  tbody.innerHTML = '';
  const rows = race?.runners || [];
  $('#runner-count').textContent = rows.length ? `${rows.length} 匹` : '';
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="9" class="muted">未有排位資料</td></tr>'; return; }
  const sorted = [...rows].sort((a, b) => {
    if (state.sort === 'odds') return (a.odds || 999) - (b.odds || 999);
    if (state.sort === 'no') return a.no - b.no;
    return (b.stake || 0) - (a.stake || 0) || (a.odds || 999) - (b.odds || 999);
  });
  sorted.forEach((r) => {
    const dv = (r.odds_prev && r.odds) ? r.odds - r.odds_prev : null;
    const tr = el('tr');
    tr.innerHTML = `
      <td class="muted">${r.no}</td>
      <td>${r.name || ''}${r.hot ? ' <span class="tag">熱</span>' : ''}<span class="muted">${r.draw ? ` (${r.draw}檔)` : ''}</span></td>
      <td class="muted">${r.jockey || ''}</td>
      <td class="num">${r.odds ? r.odds.toFixed(1) : '—'}</td>
      <td class="num muted">${r.pla ? r.pla.toFixed(1) : '—'}</td>
      <td class="num">${dv === null || dv === 0 ? '' : `<span class="${dv < 0 ? 'up' : 'down'}">${dv > 0 ? '+' : ''}${dv.toFixed(1)}</span>`}</td>
      <td class="num">${r.drop ? `<span class="up">${r.drop.toFixed(1)}</span>` : '<span class="muted">0</span>'}</td>
      <td class="num">${r.stake ? money(r.stake) : '—'}</td>
      <td class="num muted">${r.share ? pct(r.share) : '—'}</td>`;
    tbody.appendChild(row(tr));
  });
  function row(tr) { return tr; }
}

/* ----------------------------------------------------------------------- boot */
document.querySelectorAll('#runners th').forEach((th, i) => {
  th.style.cursor = 'pointer';
  th.onclick = () => {
    const map = { 0: 'no', 3: 'odds', 7: 'stake' };
    if (map[i]) { state.sort = map[i]; renderRunners(); }
  };
});

refresh();
if (!STATIC) state.timer = setInterval(refresh, 15000);
state.ageTimer = setInterval(() => {
  if (STATIC) return;
  const h = state.summary?.health;
  if (!h) return;
  if (h.last_poll) {
    const s = secs(h.last_poll);
    if (s !== null) $('#age').textContent = `資料 ${ageText(s)}`;
  }
  const race = currentRace();
  if (race?.post_time) $('#meeting-meta').textContent = $('#meeting-meta').textContent.replace(/（.*）$/, `（${countdown(race.post_time)}）`);
}, 1000);
