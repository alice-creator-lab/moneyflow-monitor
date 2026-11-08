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
let STATIC = window.MF_STATIC || null;   // GitHub Pages snapshot mode

/* In snapshot mode the page can still keep itself fresh: GitHub Pages caches every URL for
   10 minutes, but a *new* query string is a cache miss, so re-fetching data.js?ts=… returns the
   latest build without reloading the page. */
async function staticRefresh() {
  if (!window.MF_STATIC) return;
  try {
    const res = await fetch(`data.js?ts=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const txt = await res.text();
    const next = JSON.parse(txt.replace(/^\s*window\.MF_STATIC\s*=\s*/, '').replace(/;\s*$/, ''));
    STATIC = next;
    window.MF_STATIC = next;
    render();
    if (window.MF_STATIC_AFTER) window.MF_STATIC_AFTER();
  } catch (e) { /* keep showing what we have */ }
}

// one vocabulary for state, because HKJC keeps status=DEFINED while a meeting is already selling
const PHASE_LABEL = {
  presale: '未開售', selling: '開售中', racing: '賽事進行中',
  finished: '完咗', imminent: '最後衝刺', jumped: '已開跑',
};
const phaseLabel = (p) => PHASE_LABEL[p] || '—';
const phaseCls = (p) => ({ selling: 'gold', racing: 'up', imminent: 'up', finished: 'muted', jumped: 'muted' }[p] || '');

// pool-level betting status arrives as START_SELL / STOP_SELL / SUSPENDED
const POOL_STATUS = {
  START_SELL: '收注中', OPEN: '收注中', SELLING: '收注中',
  STOP_SELL: '已封盤', CLOSED: '已封盤', SUSPENDED: '暫停',
};
const poolStatus = (s) => POOL_STATUS[String(s || '').toUpperCase()] || (s || '—');

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
      const want = new URLSearchParams(location.search).get('m');
      const picked = want ? s.meetings.find((m) => m.id === want) : null;
      // prefer the meeting that is actually taking bets — a finished one also has sale_open
      const live = s.meetings.find((m) => m.phase === 'selling' || m.phase === 'racing') || null;
      state.mid = (picked || live || s.meetings[s.meetings.length - 1]).id;
    }
    if (state.mid) {
      state.meeting = await api('api/meeting/' + encodeURIComponent(state.mid));
      const races = state.meeting.races || [];
      const cur = state.meeting.cur_race || 0;
      const wantRace = parseInt(new URLSearchParams(location.search).get('r') || '0', 10);
      if (!state.race && wantRace) state.race = wantRace;
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
function raceKey() { return `${state.mid}:${state.race}`; }
function raceDone(r) {
  return !!r && (r.phase === 'finished' || r.phase === 'jumped') && !!(r.result && r.result.ok);
}

function render() {
  // a race that already has its 賽果 is settled data: render it once, then leave it alone
  const race = currentRace();
  if (raceDone(race) && state.frozen === raceKey()) {
    renderHealth();
    renderPills();
    $('#boot').textContent = STATIC
      ? '靜態快照 · 已完結場次唔再更新'
      : `已完結 · R${race.no} 賽果已鎖定，暫停更新呢場`;
    return;
  }
  if (raceDone(race)) state.frozen = raceKey(); else state.frozen = null;

  const safe = (fn) => { try { fn(); } catch (e) { console.error(fn.name, e); } };
  safe(renderHealth);
  safe(renderPills);
  safe(renderCards);
  safe(renderRaces);
  safe(renderResult);
  safe(renderChart);
  safe(renderDist);
  safe(renderBasics);
  safe(renderBlocks);
  safe(renderSpectrum);
  safe(renderHot);
  safe(renderPools);
  safe(renderRunners);
  $('#boot').textContent = STATIC
    ? '靜態快照 · GitHub Pages · 每 30–120 秒自動重新拉取'
    : `即時連線 · ${new Date().toLocaleTimeString('zh-HK', { hour12: false })} · 最後一分鐘每 1 秒更新`;
}

function renderHealth() {
  const h = state.summary?.health || {};
  if (STATIC) {
    document.querySelectorAll('.dot').forEach((d) => { d.className = 'dot ok'; });
    const stamp = String(STATIC.summary.now || '').replace('T', ' ');
    $('#age').textContent = `快照 ${stamp.slice(5, 19)}`;
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
  const sel = $('#meetings');
  if (!sel) return;
  const list = state.summary?.meetings || [];
  sel.innerHTML = list.map((m) =>
    `<option value="${m.id}"${m.id === state.mid ? ' selected' : ''}>` +
    `${m.date.slice(5)} ${m.venue} · ${phaseLabel(m.phase)}</option>`).join('');
  sel.onchange = () => {
    state.mid = sel.value;
    state.race = null;
    state.frozen = null;
    kickLoop();
  };
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
    { k: `第 ${race ? race.no : '—'} 場 WIN 池`, v: big(pool), s: race ? `${race.distance || ''}m ${race.track || ''} ${race.cls || ''}` : '' },
    { k: '5 分鐘流入', v: flow === null ? '—' : (flow >= 0 ? '+' : '') + big(Math.abs(flow)), s: flow === null ? '未有兩個時間點' : '全場合計', cls: flow > 0 ? 'up' : '' },
    { k: '賽事狀態', v: phaseLabel(m.phase), s: open, cls: phaseCls(m.phase) },
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
  $('#meeting-title').textContent = `${m.date} ${m.venue} · ${phaseLabel(m.phase)}`;
  const race = currentRace();
  $('#meeting-meta').textContent = race
    ? `${race.name || ''} ${race.distance || ''}m ${race.track || ''} · ${race.n_runners || 0} 匹 · 開跑 ${hhmm(race.post_time)}（${countdown(race.post_time)}）· ${phaseLabel(race.phase)}`
    : '';
  (m.races || []).forEach((r) => {
    const cls = ['rtab', r.no === state.race ? 'on' : '', 'rp-' + (r.phase || 'selling')].join(' ');
    const b = el('button', cls);
    const tag = r.phase && r.phase !== 'selling' && r.phase !== 'presale'
      ? `<span class="st ${phaseCls(r.phase)}">${phaseLabel(r.phase)}</span>` : '';
    b.innerHTML = `R${r.no}<span class="t">${hhmm(r.post_time)}</span>${tag}`;
    b.onclick = () => { state.race = r.no; state.frozen = null; kickLoop(); render(); };
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

/* ---------------------------------------------------------- horse basics */
function lastStartCell(ls) {
  if (!ls || !ls.date) return '<span class="muted">—</span>';
  const fin = ls.finish ? `名次 ${ls.finish}` : '名次 —';
  const sp = ls.odds ? `開跑 ${ls.odds.toFixed(1)}` : '開跑 —';
  const t5 = (ls.t5 && ls.close)
    ? `<div class="l5">最後5分鐘 ${ls.t5.toFixed(1)} → ${ls.close.toFixed(1)}` +
      `${ls.close < ls.t5 ? ' <span class="up">落飛</span>' : ls.close > ls.t5 ? ' <span class="down">回飛</span>' : ''}</div>`
    : '';
  return `<div class="ls">${ls.date.slice(5)} · R${ls.race} · ${fin}</div>
    <div class="ls2">${sp} 倍</div>${t5}`;
}

function renderBasics() {
  const tbody = $('#basics tbody');
  const race = currentRace();
  const meta = $('#basics-meta');
  if (!tbody) return;
  const rs = (race?.runners || []).slice().sort((a, b) => a.no - b.no);
  if (!rs.length) { tbody.innerHTML = '<tr><td colspan="10" class="empty">未有排位</td></tr>'; return; }
  const weights = rs.map((r) => r.weight || 0).filter(Boolean);
  const maxW = Math.max(...weights, 0);
  const heavyUnique = weights.filter((w) => w === maxW).length === 1;
  const wf = race?.winflow;
  const byNo = new Map((wf?.horses || []).map((h) => [h.no, h]));
  if (meta) meta.textContent = `R${race.no} · ${rs.length} 匹 · 跑 ${race.distance || ''}m`;

  tbody.innerHTML = rs.map((r) => {
    const f = byNo.get(r.no) || {};
    const l6 = String(r.last6 || '').trim();
    const l6html = l6 ? l6.split(/[\s,，-]+/).filter(Boolean).slice(0, 6)
      .map((x) => `<span class="l6 ${x === '1' ? 'w' : ''}">${x}</span>`).join('') : '<span class="muted">—</span>';
    const firstGear = /1$/.test(String(r.gear || '').replace(/[^A-Za-z0-9]/g, ''));
    const tags = [];
    if (firstGear) tags.push('<span class="tag">首戴</span>');
    if (r.draw && r.draw <= 3) tags.push('<span class="tag ok">內檔</span>');
    if (heavyUnique && r.weight === maxW && rs.length > 2) tags.push('<span class="tag">重磅</span>');
    if (r.ov_odds && r.odds && r.odds < r.ov_odds * 0.85) tags.push('<span class="tag up">隔夜落飛</span>');
    if (r.hot) tags.push('<span class="tag">大熱</span>');
    if (f.delta_pct >= 8) tags.push('<span class="tag up">5分鐘 +' + f.delta_pct.toFixed(0) + '%</span>');
    return `<tr>
      <td class="muted">${r.no}</td>
      <td class="sig">${tags.join(' ') || '<span class="muted">—</span>'}</td>
      <td>${r.name || ''}<span class="muted jk">${r.jockey || ''}</span></td>
      <td class="num">${r.draw ?? '—'}</td>
      <td class="num">${r.weight ?? '—'}${heavyUnique && r.weight === maxW ? '<span class="muted">*</span>' : ''}</td>
      <td class="num">${r.rating ?? '—'}</td>
      <td>${l6html}</td>
      <td>${lastStartCell(r.last_start)}</td>
      <td class="muted">${r.gear || '—'}</td>
      <td class="muted">${r.trainer || ''}</td>
    </tr>`;
  }).join('');
}

/* ------------------------------------------------------------ block trades */
function renderBlocks() {
  const box = $('#blocks');
  const race = currentRace();
  const bl = race?.blocks;
  const meta = $('#blocks-meta');
  if (!box) return;
  if (!bl || !bl.length) {
    box.innerHTML = '<div class="empty">未開售 — 未有組合資金</div>';
    if (meta) meta.textContent = '';
    return;
  }
  if (meta) meta.textContent = `R${race.no} · ${bl.length} 個彩池`;
  box.innerHTML = bl.map((b) => `
    <div class="blk">
      <div class="h"><b>${b.label}</b><span>${big(b.total)}</span></div>
      ${b.top.map((t) => `<div class="chip"><span class="c">${t.c}</span>
        <span class="m">${big(t.money)}</span><span class="p">${t.pct}%</span></div>`).join('')}
    </div>`).join('');
}

/* ------------------------------------------------------- money distribution */
// money stacked by the time band it arrived in
const BANDS = [
  ['overnight', '#5b6f8a', '隔夜（基準前）'],
  ['day', '#3f7fbf', '即日 → T-15'],
  ['p153', '#2fa37f', 'T-15 → T-3'],
  // the last 3 minutes, one 20-second slice each (heat ramp)
  ['s1', '#ffd166', 'T-180→T-160'],
  ['s2', '#ffc14d', 'T-160→T-140'],
  ['s3', '#ffab3b', 'T-140→T-120'],
  ['s4', '#ff9329', 'T-120→T-100'],
  ['s5', '#fb7a22', 'T-100→T-80'],
  ['s6', '#f2611f', 'T-80→T-60'],
  ['s7', '#e8483c', 'T-60→T-40'],
  ['s8', '#d92f4a', 'T-40→T-20'],
  ['s9', '#c11d55', 'T-20→T'],
  // a late jump: T+10, T+20 … each its own colour, until betting actually stops
  ['p1', '#a3177b', 'T+0→10s'],
  ['p2', '#8c1a99', 'T+10→20s'],
  ['p3', '#7417b3', 'T+20→30s'],
  ['p4', '#5a14c4', 'T+30→40s'],
  ['p5', '#3f10cf', 'T+40→50s'],
  ['p6', '#2a1ad6', 'T+50→60s'],
  ['p7', '#1f3fdd', 'T+60→70s'],
  ['p8', '#1b63e0', 'T+70→80s'],
  ['p9', '#1a86dd', 'T+80→90s'],
  ['p10', '#18a5d6', 'T+90→100s'],
  ['p11', '#16c0c6', 'T+100→110s'],
  ['p12', '#14d6ac', 'T+110→120s'],
  ['tail', '#8b1a4a', '開跑後殘留'],
];

function renderDist() {
  const box = $('#dist-chart');
  const race = currentRace();
  const w = race?.winflow;
  if (!w || !w.horses || !w.horses.length || !w.total) {
    $('#dist-title').textContent = '即時熱錢分佈';
    box.innerHTML = '<div class="empty">未開售 — 未有資金分佈</div>';
    return;
  }
  const lateShare = w.total ? w.late_total / w.total * 100 : 0;
  $('#dist-title').innerHTML =
    `R${race.no} 獨贏熱錢分佈 <b>${nf.format(w.total)}</b>` +
    `<span class="dist-meta">最後15分鐘 ${big(w.late_total)}（${lateShare.toFixed(0)}%）· 按到帳時段上色</span>`;

  const max = Math.max(...w.horses.map((h) => h.stake), 1);
  const H = 240;
  const rank = new Map(w.horses.map((h, i) => [h.no, i]));
  const lates = w.horses.map((h) => h.late).sort((x, y) => x - y);
  const medLate = lates[Math.floor(lates.length / 2)] || 0;
  renderDistNotes(w);
  box.innerHTML = '';
  w.horses.forEach((h) => {
    const col = el('div', 'dcol');
    const segs = BANDS.map(([k, color, label]) => [h[k] || 0, color, label]).map(([v, color, label]) => {
      if (!v) return '';
      const px = Math.max(1, (v / max) * H);
      return `<i style="height:${px.toFixed(1)}px;background:${color}" title="${label} HK$${nf.format(Math.round(v))}"></i>`;
    }).join('');
    const r = rank.get(h.no);
    const lateHot = h.late > 0 && h.late_pct >= 15 && h.late >= Math.max(1, medLate) * 1.6;
    const cls = lateHot ? 'hot' : r < 3 ? 'warm' : 'cool';
    const dp = h.delta_pct;
    const dl = dp === null || dp === undefined ? ''
      : `<div class="dl ${dp >= 0 ? 'up' : 'down'}">${dp >= 0 ? '+' : ''}${dp.toFixed(1)}%</div>`;
    col.innerHTML = `
      <div class="badge ${cls}">${h.no}</div>
      <div class="barwrap" style="height:${H}px">
        <div class="stack" style="height:${H}px">${segs}</div>
      </div>
      <div class="amt">${big(h.stake)}</div>
      <div class="od">${h.tail ? `<span style="color:#e8483c">+${big(h.tail)}</span>` : (h.m31 ? `<span style="color:#b06cff">+${big(h.m31)}</span>` : '')}</div>
      ${dl}`;
    col.title = `${h.no} ${race.runners?.find((x) => x.no === h.no)?.name || ''}\n` +
      `獨贏資金 ${money(h.stake)}（佔池 ${h.share}%）\n` +
      BANDS.map(([k, , label]) => `${label}：${money(h[k] || 0)}`).join('\n') +
      `\n對比 5 分鐘前 ${dp === null ? '—' : (dp >= 0 ? '+' : '') + dp + '%'}（份額 ${h.share_prev ?? '—'}% → ${h.share}%）` +
      `\n最近 3 分鐘 ${h.d3 == null ? '—' : `+${money(h.d3)}（+${h.d3_pct}%）`} · 最近 1 分鐘 ${h.d1 == null ? '—' : `+${money(h.d1)}（+${h.d1_pct}%）`}`;
    box.appendChild(col);
  });
}

function median(vals) {
  const s = [...vals].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

function renderDistNotes(w) {
  const box = $('#dist-notes');
  if (!box) return;
  const bits = [];
  const rank = [...w.horses].filter((h) => h.late > 0).sort((x, y) => y.late - x.late).slice(0, 3);
  if (rank.length) {
    bits.push(`<span>最後 15 分鐘熱錢榜：${rank.map((h) => `<b>${h.no} 號 +${big(h.late)}（${h.late_pct}%）</b>`).join('、')}</span>`);
  } else {
    bits.push('<span>最後 15 分鐘熱錢榜：暫時未有新增（未到 T-15）</span>');
  }
  const jump = [...w.horses].filter((h) => h.delta_pct !== null && h.delta_pct !== undefined)
    .sort((x, y) => y.delta_pct - x.delta_pct)[0];
  if (jump && jump.delta_pct > 0) {
    bits.push(`<span>5 分鐘最大升幅：<b>${jump.no} 號 +${jump.delta_pct.toFixed(1)}%</b></span>`);
  }
  const top = (k) => [...w.horses].filter((h) => (h[k] || 0) > 0).sort((x, y) => y[k] - x[k])[0];
  const j3 = top('d3');
  const j1 = top('d1');
  bits.push(j3
    ? `<span>最近 3 分鐘最大升幅：<b>${j3.no} 號 +${big(j3.d3)}（+${j3.d3_pct}%）</b></span>`
    : '<span>最近 3 分鐘最大升幅：—</span>');
  bits.push(j1
    ? `<span>最近 1 分鐘最大升幅：<b>${j1.no} 號 +${big(j1.d1)}（+${j1.d1_pct}%）</b></span>`
    : '<span>最近 1 分鐘最大升幅：—</span>');
  const race = currentRace();
  const ov = race?.overnight;
  if (ov) {
    const f = ov.flow || 0;
    bits.push(`<span>隔夜飛（${hhmm(ov.ts)} 起）：WIN 池 ${big(ov.win_inv)} → ${big(ov.win_inv + f)}，` +
      `<b>${f >= 0 ? '+' : ''}${big(Math.abs(f))}</b></span>`);
  } else {
    bits.push('<span>隔夜飛：未捕捉（賽日 09:00 前會自動記一次基準）</span>');
  }
  const last3 = w.bands?.last3;
  const last1 = w.bands?.last1;
  const w3 = last3 == null ? '—' : `+${big(last3)}`;
  const w1 = last1 == null ? '—' : `+${big(last1)}`;
  bits.push(`<span>最近 3 分鐘 ${w3} · 最近 1 分鐘 ${w1}（最後 20 秒 +${big(w.bands?.tail || 0)}）</span>`);
  bits.push('<span>' + BANDS.map(([, c, label]) =>
    `<i style="display:inline-block;width:9px;height:9px;background:${c};border-radius:2px"></i> ${label}`).join(' · ') +
    ' · Δ% = 對比 5 分鐘前</span>');
  box.innerHTML = bits.join('');
}

function renderSpectrum() {
  const tbl = $('#spec-table');
  const race = currentRace();
  const w = race?.winflow;
  const sp = (w && w.spark && w.spark.length)
    ? { buckets: w.spark, horses: (race?.runners || []).map((r) => r.no), spikes: w.spikes || [] }
    : race?.spectrum;
  const meta = $('#spec-meta');
  if (!tbl) return;
  if (!sp || !sp.buckets || !sp.buckets.length) {
    tbl.innerHTML = '';
    if (meta) meta.textContent = '未夠時間累積頻譜（每分鐘一格）';
    return;
  }
  const nos = sp.horses;
  const spikeSet = new Set((sp.spikes || []).map((s) => `${s.t}|${s.no}`));
  // bands are relative to a fair share (100/n) so small and big fields read the same
  const fair = 100 / Math.max(1, nos.length);
  const band = (v) => {
    const r = v / fair;
    return r >= 2 ? 'c3' : r >= 1.3 ? 'c2' : r >= 0.7 ? 'c1' : 'c0';
  };
  let html = '<thead><tr><th></th>' + nos.map((n) => `<th class="no">${n}</th>`).join('') + '</tr></thead><tbody>';
  sp.buckets.slice().reverse().forEach((b) => {
    let mt = '';
    if (b.m !== null && b.m !== undefined) {
      mt = Math.abs(b.m) >= 120 ? `T${(b.m / 60).toFixed(1)}h`
        : (b.m < 0 ? `T${b.m}` : `T+${b.m}`);
    }
    html += `<tr><td class="t">${b.t}<span class="tl">${mt}</span></td>`;
    nos.forEach((n) => {
      const v = b.cells[String(n)] || 0;
      const cls = `${band(v)}${spikeSet.has(`${b.t}|${n}`) ? ' spike' : ''}`;
      html += `<td class="${cls}" title="${n} 號 ${b.t}：${v}%">${v >= 10 ? Math.round(v) : ''}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody>';
  tbl.innerHTML = html;
  if (meta) {
    const sp2 = (sp.spikes || []).length;
    meta.textContent = `每格 = 該馬在該分鐘的獨贏資金份額；黃框 = 一點紅（高過自身中位數 1.5 倍且高過公平份額）${sp2 ? `，暫見 ${sp2} 個` : ''}`;
  }
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
  const order = ['WIN', 'PLA', 'QIN', 'QPL', 'FCT', 'TCE', 'TRI', 'FF', 'QTT', 'CWA', 'CWB', 'CWC', 'IWN', 'DBL', 'TBL', 'DT', 'TT', 'SixUP'];
  const legNo = (p) => parseInt(String(p.leg || '').split('-')[0], 10) || 0;
  const pools = (m?.pools || []).slice().sort((a, b) => {
    const ta = order.indexOf(a.type), tb = order.indexOf(b.type);
    if (ta !== tb) return (ta < 0 ? 99 : ta) - (tb < 0 ? 99 : tb);
    if (legNo(a) !== legNo(b)) return legNo(a) - legNo(b);
    const an = a.inv === null || a.inv === undefined ? -1 : a.inv;
    const bn = b.inv === null || b.inv === undefined ? -1 : b.inv;
    return bn - an;
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
      <td class="sell ${open ? 'open' : ''}">${poolStatus(sell)}</td>`;
    tbody.appendChild(tr);
  });
}

/* --------------------------------------------------------------------- result */
function renderResult() {
  const card = $('#result-card');
  if (!card) return;
  const race = currentRace();
  const res = race?.result;
  if (!res || !res.ok) { card.hidden = true; return; }
  card.hidden = false;

  const finishers = (res.rows || []).filter((r) => /^\d+$/.test(r.finish));
  const top = finishers.slice(0, 4);
  $('#result-meta').textContent =
    `R${race.no} · ${top[0] ? top[0].name + ' 勝出' : ''} · ${(res.rows || []).length} 匹`;

  const rows = top.map((r, i) => `<div class="rc${i === 0 ? ' win' : ''}">
      <span class="pos">${r.finish}</span>
      <span class="no">${r.no}</span>
      <span class="nm">${r.name}<span class="jk">${r.jockey || ''}</span></span>
      <span class="od">${Number.isFinite(Number(r.odds)) && Number(r.odds) > 0 ? Number(r.odds).toFixed(1) : '—'}</span>
      <span class="mg">${i === 0 ? '—' : (r.dist || '')}</span>
    </div>`).join('');

  const divs = res.dividends || [];
  const of = (name) => divs.filter((d) => d.pool === name);
  const line = [['獨贏', of('獨贏')], ['位置', of('位置')], ['連贏', of('連贏')], ['位置Q', of('位置Q')]]
    .filter(([, arr]) => arr.length)
    .map(([name, arr]) => `<span class="dv"><b>${name}</b> ` +
      arr.map((d) => `${d.combo} $${d.dividend === null ? '—' : d.dividend}`).join(' · ') + '</span>')
    .join('');

  const head = '<div class="rc-head"><span>名</span><span>馬號</span><span>馬名</span>' +
    '<span>開跑</span><span>距離</span></div>';
  $('#result-body').innerHTML = `<div class="podium">${head}${rows}</div>` +
    (line ? `<div class="dvs">${line}</div>` : '');
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
      <td>${r.name || ''}${r.hot ? ' <span class="tag">熱</span>' : ''}<span class="muted">${r.draw ? ` (${r.draw}檔)` : ''}</span><span class="muted jk">${r.jockey || ''}</span></td>
      <td class="num">${r.odds ? r.odds.toFixed(1) : '—'}</td>
      <td class="num muted">${r.pla ? r.pla.toFixed(1) : '—'}</td>
      <td class="num">${dv === null || dv === 0 ? '' : `<span class="${dv < 0 ? 'up' : 'down'}">${dv > 0 ? '+' : ''}${dv.toFixed(1)}</span>`}</td>
      <td class="num muted">${ovCell(r)}</td>
      <td class="num">${r.drop ? `<span class="up">${r.drop.toFixed(1)}</span>` : '<span class="muted">0</span>'}</td>
      <td class="num">${r.stake ? money(r.stake) : '—'}</td>
      <td class="num muted">${r.share ? pct(r.share) : '—'}</td>`;
    tbody.appendChild(row(tr));
  });
  function row(tr) { return tr; }
}

function ovCell(r) {
  if (!r.ov_odds) return '—';
  if (!r.odds) return r.ov_odds.toFixed(1);
  const d = r.odds - r.ov_odds;
  const cls = d < -0.05 ? 'up' : d > 0.05 ? 'down' : 'muted';
  return `${r.ov_odds.toFixed(1)}<span class="${cls}"> ${d > 0 ? '+' : ''}${d.toFixed(1)}</span>`;
}

/* ----------------------------------------------------------------------- boot */
document.querySelectorAll('#runners th').forEach((th, i) => {
  th.style.cursor = 'pointer';
  th.onclick = () => {
    const map = { 0: 'no', 2: 'odds', 7: 'stake' };
    if (map[i]) { state.sort = map[i]; renderRunners(); }
  };
});

refresh();
// adaptive refresh: the closer the off, the faster the page reloads
const secsToPost = () => {
  const races = state.meeting?.races || [];
  let best = null;
  for (const r of races) {
    const t = r.post_time ? Date.parse(r.post_time) : NaN;
    if (Number.isNaN(t)) continue;
    const left = (t - Date.now()) / 1000;
    if (left >= -90 && (best === null || left < best)) best = left;
  }
  return best;
};
const refreshMs = () => {
  if (STATIC) return 0;
  // a finished meeting whose race is already frozen needs no polling at all
  if (state.frozen === raceKey() && state.meeting?.phase === 'finished') return null;
  const s = secsToPost();
  if (s === null) return 15000;
  if (s <= 40) return 1500;
  if (s <= 70) return 1000;     // last minute: refresh every second
  if (s <= 300) return 2000;
  if (s <= 900) return 4000;
  return 12000;
};
const loopTick = async () => {
  await refresh();
  const ms = refreshMs();
  if (ms === null) {
    state.timer = null;
    $('#boot').textContent = '賽果已鎖定 · 停止更新（切換場次會重新開始）';
    return;
  }
  state.timer = setTimeout(loopTick, ms);
};

function kickLoop(delay = 0) {
  if (STATIC) return;
  clearTimeout(state.timer);
  state.timer = setTimeout(loopTick, delay);
}

if (!STATIC) {
  state.timer = setTimeout(loopTick, 1000);
} else {
  // snapshot build: pull the newest data.js (cache-busted) instead of reloading the page
  const snapLoop = async () => {
    if (state.frozen === raceKey() && state.meeting?.phase === 'finished') {
      $('#boot').textContent = '賽果已鎖定 · 快照停止更新（切換場次會重新開始）';
      return;
    }
    await staticRefresh();
    const race = currentRace();
    const left = race?.post_time ? secs(race.post_time) : null;
    const near = left !== null && left > -60 && left <= 1200;
    state.snapTimer = setTimeout(snapLoop, near ? 30000 : 120000);
  };
  state.snapTimer = setTimeout(snapLoop, 1500);   // pull the newest build straight away
}
state.ageTimer = setInterval(() => {
  if (STATIC) {
    const race = currentRace();
    if (race?.post_time && $('#meeting-meta')) {
      $('#meeting-meta').textContent = $('#meeting-meta').textContent.replace(/（.*?）/, `（${countdown(race.post_time)}）`);
    }
    return;
  }
  const h = state.summary?.health;
  if (!h) return;
  if (h.last_poll) {
    const s = secs(h.last_poll);
    if (s !== null) $('#age').textContent = `資料 ${ageText(s)}`;
  }
  const race = currentRace();
  if (race?.post_time) $('#meeting-meta').textContent = $('#meeting-meta').textContent.replace(/（.*）$/, `（${countdown(race.post_time)}）`);
}, 1000);
