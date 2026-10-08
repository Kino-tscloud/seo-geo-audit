/* ==========================================================
   SEO / GEO 健檢 — 介面與資料抓取
   ========================================================== */
(function () {
  'use strict';
  const A = window.SeoAudit;
  const esc = A.esc;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  let mode = 'url';
  let report = null;
  let faqItems = [];

  /* ---------- 小工具 ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  };
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800);
  }
  function tone(score) { return score >= 80 ? 'good' : score >= 50 ? 'warn' : 'bad'; }
  function grade(s) { return s >= 90 ? 'A+' : s >= 80 ? 'A' : s >= 70 ? 'B' : s >= 60 ? 'C' : s >= 50 ? 'D' : 'F'; }
  function colorVar(t) { return `var(--${t})`; }
  function copy(text) {
    const done = () => toast('已複製到剪貼簿');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallback());
    else fallback();
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('複製失敗，請手動選取'); }
      ta.remove();
    }
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function normalizeUrl(u) {
    u = (u || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try { return new URL(u).href; } catch (e) { return ''; }
  }

  /* ---------- 主題 ---------- */
  (function theme() {
    const saved = store.get('theme', null);
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    $('#themeBtn').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') ||
        (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      store.set('theme', next);
    });
  })();

  /* ---------- 視覺效果 ---------- */
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 標題輪播文字
  (function rotator() {
    const words = $$('#rotator > span');
    if (words.length < 2 || reduceMotion) return;
    let i = 0;
    setInterval(() => {
      const cur = words[i];
      i = (i + 1) % words.length;
      cur.classList.remove('on'); cur.classList.add('out');
      words[i].classList.remove('out'); words[i].classList.add('on');
      setTimeout(() => cur.classList.remove('out'), 500);
    }, 2400);
  })();
  // AI 爬蟲跑馬燈
  (function marquee() {
    const track = $('#marquee');
    if (!track) return;
    const items = A.AI_BOTS.map(b => `<span><b>${esc(b.ua)}</b> · ${esc(b.use)}</span>`).join('');
    track.innerHTML = items + items;
  })();
  // 捲動進場 + 數字跑動
  (function reveal() {
    const els = $$('.reveal');
    const counters = $$('.stats-strip [data-count]');
    if (!('IntersectionObserver' in window) || reduceMotion) { els.forEach(e => e.classList.add('in')); return; }
    const io = new IntersectionObserver(entries => entries.forEach(en => {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      en.target.querySelectorAll('[data-count]').forEach(c => countUp(c, 1600));
      io.unobserve(en.target);
    }), { threshold: .12, rootMargin: '0px 0px -40px 0px' });
    counters.forEach(c => c.textContent = '0');
    els.forEach(e => io.observe(e));
  })();
  // 卡片滑鼠光暈
  document.addEventListener('pointermove', e => {
    const el = e.target.closest && e.target.closest('.spot');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    el.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  /* ---------- 模式切換 ---------- */
  $$('.mode-tabs button').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    $$('.mode-tabs button').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', x === b); });
    $('#modeUrl').classList.toggle('hide', mode !== 'url');
    $('#modeHtml').classList.toggle('hide', mode !== 'html');
  }));

  /* ---------- 最近檢測 ---------- */
  function renderRecent() {
    const list = store.get('recent', []);
    const box = $('#recent');
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = '最近檢測：' + list.map((r, i) =>
      `<button type="button" data-i="${i}" title="${esc(r.url)}">${esc(r.url.replace(/^https?:\/\/(www\.)?/, ''))} · ${r.score}</button>`).join('');
    box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const r = list[+b.dataset.i];
      $$('.mode-tabs button')[0].click();
      $('#urlInput').value = r.url;
      $('#kwInput').value = r.keyword || '';
    }));
  }
  function pushRecent(rep) {
    if (!rep.url) return;
    let list = store.get('recent', []).filter(r => r.url !== rep.url);
    list.unshift({ url: rep.url, keyword: rep.keyword, score: rep.overall });
    store.set('recent', list.slice(0, 6));
    renderRecent();
  }
  renderRecent();

  /* ---------- 抓取（直接 → CORS 代理） ---------- */
  // 原始 HTML 來源（同時競速，先回來且內容有效者勝出）
  const RAW_SOURCES = [
    { name: 'direct', make: u => u },
    { name: 'allorigins', make: u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
    { name: 'codetabs', make: u => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u) }
  ];
  // 備援：Jina Reader（支援 CORS；網頁取回的是瀏覽器渲染後的 DOM）
  const jina = format => ({ name: 'jina', make: u => 'https://r.jina.ai/' + u, headers: { 'X-Return-Format': format } });

  async function fetchVia(src, url, timeout) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    const t0 = performance.now();
    try {
      const res = await fetch(src.make(url), { signal: ctl.signal, redirect: 'follow', cache: 'no-store', headers: src.headers || {} });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text, ms: Math.round(performance.now() - t0), via: src.name };
    } finally { clearTimeout(t); }
  }
  // kind: 'page'（網頁）或 'text'（robots / sitemap / llms）
  async function fetchText(url, opts) {
    opts = opts || {};
    const timeout = opts.timeout || 15000;
    const valid = r => r.ok && (!opts.validate || opts.validate(r.text, r.via));
    let missing = false, status = null, settled = false;
    const raw = RAW_SOURCES.map(s => fetchVia(s, url, timeout).then(r => {
      if (valid(r)) return r;
      if (r.status === 404 || r.status === 410) { missing = true; status = r.status; }
      throw r;
    }));
    // 原始來源 4 秒內沒有結果才啟動備援（節省 Jina 免費額度），之後誰先回來就用誰
    const backup = new Promise(res => setTimeout(res, 4000))
      .then(() => settled ? null : fetchVia(jina(opts.kind === 'page' ? 'html' : 'text'), url, timeout + 8000))
      .then(r => {
        if (!r) throw null;
        if (valid(r)) { r.rendered = opts.kind === 'page'; return r; }
        if (r.ok || [404, 410, 422].includes(r.status)) missing = true;
        status = status || r.status;
        throw r;
      });
    try { const r = await Promise.any([...raw, backup]); settled = true; return r; }
    catch (e) { settled = true; return { ok: false, missing, status }; }
  }
  const notHtml = t => !/^\s*<(!doctype|html|head|body)/i.test(t);
  // Jina 會把 XML sitemap 轉成純文字網址清單，這裡轉回 <loc> 以便統計
  const sitemapOk = (t, via) => /<(urlset|sitemapindex)/i.test(t) ||
    (via === 'jina' && (t.match(/^\s*https?:\/\/\S+\s*$/gm) || []).length >= 1 && !/404|not found/i.test(t.slice(0, 300)));
  function normalizeSitemap(t) {
    if (/<loc>/i.test(t)) return t;
    return '<urlset>' + (t.match(/^\s*https?:\/\/\S+\s*$/gm) || []).map(u => `<loc>${u.trim()}</loc>`).join('') + '</urlset>';
  }
  async function fetchAux(url, validate) {
    try {
      const r = await fetchText(url, { validate, timeout: 10000, kind: 'text' });
      if (r.ok) return { state: 'ok', text: r.text, url };
      return { state: r.missing ? 'missing' : 'unknown', url };
    } catch (e) { return { state: 'unknown', url }; }
  }

  /* ---------- 進度 ---------- */
  function progress(steps) {
    const box = $('#progress'), ol = $('#progressList');
    ol.innerHTML = steps.map((s, i) => `<li data-i="${i}"><span class="dot"></span>${esc(s)}</li>`).join('');
    box.classList.add('show');
    return {
      set(i, state) {
        const li = ol.querySelector(`li[data-i="${i}"]`);
        if (!li) return;
        li.className = state;
        li.querySelector('.dot').textContent = state === 'done' ? '✓' : state === 'fail' ? '!' : '';
      },
      hide() { box.classList.remove('show'); }
    };
  }
  function alertMsg(html, kind) {
    $('#alertBox').innerHTML = html ? `<div class="alert alert-${kind || 'error'}">${html}</div>` : '';
  }

  /* ---------- 執行健檢 ---------- */
  async function runAudit(e) {
    if (e) e.preventDefault();
    alertMsg('');
    const keyword = $('#kwInput').value.trim();
    const btn = $('#runBtn');
    let html = '', url = '', ctx = { keyword };

    if (mode === 'url') {
      url = normalizeUrl($('#urlInput').value);
      if (!url) { alertMsg('請輸入有效的網址，例如 https://www.example.com/'); $('#urlInput').focus(); return; }
      $('#urlInput').value = url;
      btn.disabled = true; btn.textContent = '檢測中…';
      const origin = new URL(url).origin;
      const p = progress(['讀取網頁 HTML', '讀取 robots.txt', '讀取 sitemap.xml', '讀取 llms.txt', '分析 70+ 項指標']);
      p.set(0, 'run');
      const main = await fetchText(url, { kind: 'page', timeout: 20000, validate: t => t && t.length > 50 && /<[a-z]/i.test(t) });
      if (!main.ok) {
        p.set(0, 'fail'); p.hide();
        btn.disabled = false; btn.textContent = '🔍 開始健檢';
        alertMsg(`無法讀取此網址${main.status ? `（HTTP ${main.status}）` : ''}。可能原因：網站阻擋代理、需要 JavaScript 驗證，或代理暫時無法使用。<br>👉 請改用 <b>「貼上原始碼」</b> 模式：在目標網頁按 <b>Ctrl+U</b> 檢視原始碼 → 全選複製 → 貼上即可。`);
        return;
      }
      p.set(0, 'done');
      html = main.text;
      ctx.fetchMs = main.ms; ctx.via = main.via; ctx.rendered = !!main.rendered;
      [1, 2, 3].forEach(i => p.set(i, 'run'));
      const [robots, sitemap, llms] = await Promise.all([
        fetchAux(origin + '/robots.txt', t => notHtml(t) && /(user-agent|disallow|allow|sitemap)\s*:/i.test(t)).then(r => { p.set(1, r.state === 'ok' ? 'done' : 'fail'); return r; }),
        fetchAux(origin + '/sitemap.xml', sitemapOk).then(r => { p.set(2, r.state === 'ok' ? 'done' : 'fail'); return r; }),
        fetchAux(origin + '/llms.txt', t => notHtml(t) && /^\s*#\s*\S/.test(t)).then(r => { p.set(3, r.state === 'ok' ? 'done' : 'fail'); return r; })
      ]);
      // robots.txt 若宣告了其他 sitemap 位置，再試一次
      if (sitemap.state !== 'ok' && robots.state === 'ok') {
        const m = robots.text.match(/^\s*sitemap:\s*(\S+)/im);
        if (m) {
          const s2 = await fetchAux(m[1], sitemapOk);
          if (s2.state === 'ok') { Object.assign(sitemap, s2); p.set(2, 'done'); }
        }
      }
      if (sitemap.state === 'ok') sitemap.text = normalizeSitemap(sitemap.text);
      Object.assign(ctx, { url, robots, sitemap, llms });
      p.set(4, 'run');
      await new Promise(r => setTimeout(r, 120));
      finish(html, ctx, p);
    } else {
      html = $('#htmlInput').value;
      if (!html.trim() || !/<[a-z!]/i.test(html)) { alertMsg('請貼上完整的 HTML 原始碼。'); $('#htmlInput').focus(); return; }
      url = normalizeUrl($('#baseInput').value);
      Object.assign(ctx, { url, robots: { state: 'unknown' }, sitemap: { state: 'unknown' }, llms: { state: 'unknown' } });
      finish(html, ctx, null);
    }
  }

  function finish(html, ctx, p) {
    const btn = $('#runBtn');
    try {
      report = A.run(html, ctx);
      if (p) { p.set(4, 'done'); setTimeout(() => p.hide(), 600); }
      render(report);
      pushRecent(report);
      if (ctx.rendered) {
        alertMsg('原始 HTML 代理無法使用，已改用 Jina Reader 讀取「瀏覽器渲染後」的頁面；「伺服器端可讀內容」與 DOCTYPE 項目不予計分。若要最精準的結果，請改用「貼上原始碼」。', 'warn');
      } else if (ctx.via && ctx.via !== 'direct') {
        alertMsg(`已透過公開代理（${esc(ctx.via)}）讀取頁面。若網站對不同來源回傳不同內容，結果可能與實際略有差異。`, 'warn');
      }
      setTimeout(() => $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } catch (err) {
      console.error(err);
      if (p) p.hide();
      alertMsg('分析時發生錯誤：' + esc(err.message));
    } finally {
      btn.disabled = false; btn.textContent = '🔍 開始健檢';
    }
  }

  $('#auditForm').addEventListener('submit', runAudit);
  $('#demoBtn').addEventListener('click', () => {
    const d = window.DEMO_PAGE;
    $$('.mode-tabs button')[1].click();
    $('#htmlInput').value = d.html;
    $('#baseInput').value = d.url;
    $('#kwInput').value = d.keyword;
    alertMsg('');
    finish(d.html, {
      url: d.url, keyword: d.keyword,
      robots: { state: 'ok', text: d.robots }, sitemap: { state: 'missing', url: new URL(d.url).origin + '/sitemap.xml' }, llms: { state: 'missing' }
    }, null);
  });

  /* ==========================================================
     渲染
     ========================================================== */
  let gid = 0;
  function gauge(score, sm) {
    const r = 52, c = 2 * Math.PI * r, t = tone(score), id = 'gg' + (++gid);
    return `<div class="gauge${sm ? ' sm' : ''}">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${colorVar(t)}"/><stop offset="1" stop-color="${colorVar(t + '-2')}"/>
          </linearGradient>
          <filter id="${id}f" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>
        </defs>
        <circle class="track" cx="60" cy="60" r="${r}" fill="none" stroke-width="10"/>
        <circle class="bar" cx="60" cy="60" r="${r}" fill="none" stroke-width="10" stroke-linecap="round" opacity=".55" filter="url(#${id}f)"
          stroke="url(#${id})" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-target="${c * (1 - score / 100)}"/>
        <circle class="bar" cx="60" cy="60" r="${r}" fill="none" stroke-width="10" stroke-linecap="round"
          stroke="url(#${id})" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-target="${c * (1 - score / 100)}"/>
      </svg>
      <div class="val"><div><b class="c-${t}" data-count="${score}">0</b><span>/ 100</span></div></div>
    </div>`;
  }
  // 數字跑動
  function countUp(el, dur) {
    const end = +el.dataset.count, t0 = performance.now();
    dur = dur || 1400;
    const step = now => {
      const p = Math.min(1, (now - t0) / dur), v = Math.round(end * (1 - Math.pow(1 - p, 3)));
      el.textContent = v.toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // 高分彩帶
  function confetti() {
    const box = document.createElement('div');
    box.className = 'confetti';
    const colors = ['#a78bfa', '#22d3ee', '#34d399', '#f472b6', '#fbbf24'];
    for (let i = 0; i < 90; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + 'vw';
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = 2.2 + Math.random() * 2 + 's';
      p.style.animationDelay = Math.random() * .6 + 's';
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 5000);
  }
  function scoreCard(el, score, title, desc, big) {
    el.innerHTML = gauge(score, !big) + `<div class="txt"><h3>${title}</h3><p>${desc}</p><span class="grade bg-${tone(score)}">等級 ${grade(score)}</span></div>`;
  }
  const STATUS = {
    pass: { i: '✓', cls: 'good', label: '通過' },
    warn: { i: '!', cls: 'warn', label: '警告' },
    fail: { i: '✕', cls: 'bad', label: '未通過' },
    info: { i: 'i', cls: 'info', label: '資訊' }
  };
  const IMPACT = { high: ['高影響', 'bad'], medium: ['中影響', 'warn'], low: ['低影響', 'info'] };
  const BASIS = {
    g: ['官方規範', 'Google 或官方文件明文說明'],
    p: ['最佳實務', '業界普遍認同的做法，非排名規則'],
    h: ['經驗值', '參考數字，搜尋引擎沒有官方標準']
  };

  function render(rep) {
    $('#results').classList.add('show');
    const d = rep.data;
    $('#resMeta').innerHTML = `${d.url ? esc(d.url) : '（貼上原始碼）'}${rep.keyword ? ` · 關鍵字：<b>${esc(rep.keyword)}</b>` : ''} · ${new Date(rep.when).toLocaleString('zh-TW')}`;

    scoreCard($('#scoreOverall'), rep.overall, '綜合健康分數', '11 大類加權總分', true);
    scoreCard($('#scoreSeo'), rep.seoScore, 'SEO 分數', '傳統搜尋引擎優化');
    scoreCard($('#scoreGeo'), rep.geoScore, 'GEO 分數', 'AI 搜尋可見度與引用潛力');
    requestAnimationFrame(() => setTimeout(() => $$('.gauge .bar').forEach(b => b.style.strokeDashoffset = b.dataset.target), 30));

    const all = rep.categories.flatMap(c => c.checks);
    const n = s => all.filter(k => k.status === s).length;
    $('#statRow').innerHTML = [
      [n('pass'), '✅ 通過', 'good'], [n('warn'), '⚠️ 警告', 'warn'], [n('fail'), '❌ 未通過', 'bad'], [d.words, '📝 內容字數', 'info']
    ].map(([v, l, t]) => `<div class="stat c-${t}"><b data-count="${v}">0</b><span>${l}</span></div>`).join('');
    $$('#scoreOverall [data-count], #scoreSeo [data-count], #scoreGeo [data-count], #statRow [data-count]').forEach(el => countUp(el));
    if (rep.overall >= 85) setTimeout(confetti, 700);

    // 類別列表
    $('#catList').innerHTML = rep.categories.map(c => `
      <div class="cat-row" data-cat="${c.id}" title="查看 ${esc(c.name)} 詳細檢查">
        <span class="ico">${c.icon}</span>
        <div><div class="name">${esc(c.name)} <small>權重 ${c.weight}%</small></div>
          <div class="meter"><i style="background:linear-gradient(90deg, ${colorVar(tone(c.score))}, ${colorVar(tone(c.score) + '-2')});color:${colorVar(tone(c.score))}" data-w="${c.score}"></i></div></div>
        <span class="num c-${tone(c.score)}">${c.score}</span>
      </div>`).join('');
    setTimeout(() => $$('#catList .meter i').forEach(i => i.style.width = i.dataset.w + '%'), 60);
    $$('#catList .cat-row').forEach(r => r.addEventListener('click', () => {
      switchTab('checks');
      const el = document.getElementById('cat-' + r.dataset.cat);
      if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    }));

    renderSerp('desktop');
    renderChecks('all');
    renderRecs();
    renderCode();
    renderData();
    $('#cntChecks').textContent = all.length;
    $('#cntRecs').textContent = all.filter(k => k.status === 'fail' || k.status === 'warn').length;
    switchTab('overview');
  }

  /* SERP 預覽 */
  function renderSerp(kind) {
    const d = report.data;
    let host = 'example.com', path = '';
    try { const u = new URL(d.url); host = u.hostname; path = u.pathname.split('/').filter(Boolean).join(' › '); } catch (e) { }
    const tMax = kind === 'mobile' ? 64 : 60, dMax = kind === 'mobile' ? 130 : 160;
    const title = d.title ? A.truncUnits(d.title, tMax) : '（缺少標題，Google 會自行產生）';
    const desc = d.desc ? A.truncUnits(d.desc, dMax) : '（缺少描述，Google 會從頁面內文擷取片段）';
    const kw = report.keyword;
    const hl = s => { s = esc(s); return kw ? s.split(esc(kw)).join(`<b>${esc(kw)}</b>`) : s; };
    $('#serpBox').innerHTML = `<div class="serp" style="max-width:${kind === 'mobile' ? '380px' : '600px'}">
      <div class="site"><span class="fav">${d.favicon ? `<img src="${esc(d.favicon)}" alt="" width="18" height="18" onerror="this.remove()">` : '🌐'}</span>
        <div><div class="sname">${esc(d.siteName || host)}</div><div class="surl">https://${esc(host)}${path ? ' › ' + esc(path) : ''}</div></div></div>
      <div class="stitle">${hl(title)}</div>
      <div class="sdesc">${hl(desc)}</div>
    </div>
    <p class="small muted" style="margin:8px 0 0">標題寬度 ${A.units(d.title)} / 建議 30–60；描述寬度 ${A.units(d.desc)} / 建議 100–160（中文字計 2）。</p>`;
  }
  $$('[data-serp]').forEach(b => b.addEventListener('click', () => {
    $$('[data-serp]').forEach(x => x.classList.toggle('active', x === b));
    renderSerp(b.dataset.serp);
  }));

  /* 詳細檢查 */
  function checkRow(k, catName) {
    const s = STATUS[k.status];
    const imp = (k.status === 'fail' || k.status === 'warn') && IMPACT[k.impact] ? `<span class="impact bg-${IMPACT[k.impact][1]}">${IMPACT[k.impact][0]}</span>` : '';
    return `<div class="check" data-status="${k.status}">
      <span class="st bg-${s.cls}" title="${s.label}">${s.i}</span>
      <div>
        <div class="ct">${esc(k.title)}${imp}${BASIS[k.basis] ? `<span class="basis basis-${k.basis}" title="${BASIS[k.basis][1]}">${BASIS[k.basis][0]}</span>` : ''}${catName ? ` <span class="small muted">· ${esc(catName)}</span>` : ''}</div>
        <div class="cd">${esc(k.detail)}</div>
        ${k.fix ? `<div class="cf"><b>建議：</b>${esc(k.fix)}</div>` : ''}
      </div>
      <span class="pts">${k.max ? `${k.score}/${k.max}` : '—'}</span>
    </div>`;
  }
  function renderChecks(filter) {
    $('#checkList').innerHTML = report.categories.map(c => {
      const list = c.checks.filter(k => filter === 'all' || k.status === filter);
      if (!list.length) return '';
      return `<details class="cat-block" id="cat-${c.id}" ${filter !== 'all' || c.score < 80 ? 'open' : ''}>
        <summary>
          <span style="font-size:20px">${c.icon}</span>
          <span class="t">${esc(c.name)}<small>${esc(c.desc)} · 權重 ${c.weight}%</small></span>
          <span class="mini">
            ${c.counts.pass ? `<span class="bg-good">${c.counts.pass} 通過</span>` : ''}
            ${c.counts.warn ? `<span class="bg-warn">${c.counts.warn} 警告</span>` : ''}
            ${c.counts.fail ? `<span class="bg-bad">${c.counts.fail} 未通過</span>` : ''}
          </span>
          <span class="badge-score bg-${tone(c.score)}">${c.score}</span>
          <span class="chev">▶</span>
        </summary>
        ${list.map(k => checkRow(k)).join('')}
      </details>`;
    }).join('') || '<p class="muted">沒有符合條件的項目。</p>';
  }
  $$('#checkFilter .chip').forEach(b => b.addEventListener('click', () => {
    $$('#checkFilter .chip').forEach(x => x.classList.toggle('active', x === b));
    renderChecks(b.dataset.f);
  }));

  /* 優化建議（依影響排序） */
  function rankedIssues() {
    const impW = { high: 3, medium: 2, low: 1 };
    return report.categories.flatMap(c => {
      const catMax = c.checks.reduce((n, k) => n + k.max, 0) || 1;
      return c.checks.filter(k => (k.status === 'fail' || k.status === 'warn') && k.fix).map(k => ({
        k, c,
        gain: Math.round((k.max - k.score) / catMax * c.weight * 10) / 10,
        rank: ((k.max - k.score) / catMax * c.weight) * impW[k.impact || 'medium'] + (k.status === 'fail' ? 2 : 0)
      }));
    }).sort((a, b) => b.rank - a.rank);
  }
  function priorityOf(it) {
    if (it.k.impact === 'high' && it.k.status === 'fail') return 1;
    if (it.k.impact === 'high' || (it.k.impact === 'medium' && it.k.status === 'fail')) return 2;
    return 3;
  }
  function recRow(it, i) {
    const t = it.k.status === 'fail' ? 'bad' : 'warn';
    return `<div class="rec">
      <span class="n bg-${t}">${i + 1}</span>
      <div><h4>${it.c.icon} ${esc(it.k.title)}</h4>
        <p>${esc(it.k.fix)}</p>
        <span class="tag">${esc(it.c.name)} · 現況：${esc(A.truncUnits(it.k.detail, 120))} · 預估總分 +${it.gain}</span></div>
    </div>`;
  }
  function renderRecs() {
    const items = rankedIssues();
    $('#topFix').innerHTML = items.length ? items.slice(0, 5).map(recRow).join('') : '<p class="muted">太棒了，沒有需要修正的項目！</p>';
    const groups = [
      [1, '🔴 第一優先：立即修正', '影響索引、排名或 AI 引用的關鍵問題'],
      [2, '🟠 第二優先：近期優化', '能明顯提升分數與點擊率的項目'],
      [3, '🔵 第三優先：持續改善', '細節優化與加分項目']
    ];
    let idx = 0;
    $('#recList').innerHTML = items.length ? groups.map(([p, h, sub]) => {
      const list = items.filter(it => priorityOf(it) === p);
      if (!list.length) return '';
      return `<div class="prio-head"><h3>${h}</h3><span class="small muted">${sub} · ${list.length} 項</span></div>` +
        list.map(it => recRow(it, idx++)).join('');
    }).join('<div style="height:18px"></div>') : '<p class="muted">沒有需要修正的項目。</p>';
  }

  /* 程式碼產生器 */
  function codeBlock(id, title, desc, code) {
    return `<div class="card code-card">
      <div class="code-head"><h3>${title}</h3>
        <div class="actions"><button class="btn btn-ghost btn-sm" data-copy="${id}" type="button">📋 複製</button></div></div>
      ${desc ? `<p class="desc">${desc}</p>` : ''}
      <pre class="code" id="code-${id}">${esc(code)}</pre>
    </div>`;
  }
  function renderCode() {
    const s = A.snippets(report);
    faqItems = report.data.faqs.length ? report.data.faqs.map(f => ({ q: f.q, a: f.a })) : [{ q: '', a: '' }, { q: '', a: '' }, { q: '', a: '' }];
    $('#codeList').innerHTML =
      `<div class="card code-card faq-editor">
        <div class="code-head"><h3>❓ FAQPage 產生器</h3>
          <div class="actions">
            <button class="btn btn-ghost btn-sm" id="faqAdd" type="button">＋ 新增問題</button>
            <button class="btn btn-ghost btn-sm" data-copy="faq" type="button">📋 複製 JSON-LD</button>
            <button class="btn btn-ghost btn-sm" data-copy="faqhtml" type="button">📋 複製 HTML</button>
          </div></div>
        <p class="desc">${report.data.faqs.length ? `已從頁面自動擷取 ${report.data.faqs.length} 組問答，可直接編輯。` : '頁面未偵測到問答，請輸入 3–8 個使用者常問的問題。'}答案第一句請直接回答，建議 40–150 字。JSON-LD 放在 &lt;head&gt; 或 &lt;/body&gt; 前；HTML 區塊放在頁面中，讓問答「可見」。</p>
        <div id="faqRows"></div>
        <pre class="code" id="code-faq"></pre>
        <div style="height:10px"></div>
        <pre class="code" id="code-faqhtml"></pre>
      </div>` +
      codeBlock('head', '🏷️ 建議的 &lt;head&gt; 標籤（TDK + OG + Twitter）', '已依目前頁面內容預填，請確認標題與描述符合長度建議後取代原有標籤。', s.head) +
      codeBlock('org', '🧩 Organization + WebSite + WebPage（JSON-LD）', '建立品牌實體。請把 logo、sameAs（社群連結）、電話換成真實資料，以 &lt;script type="application/ld+json"&gt; 包起來。', s.org) +
      codeBlock('article', '📰 Article（文章頁適用）', '部落格或知識文章使用，務必填寫真實作者與日期以強化 E-E-A-T。', s.article) +
      codeBlock('breadcrumb', '🧭 BreadcrumbList 麵包屑', '依網址路徑自動產生，請將名稱改為實際頁面名稱。', s.breadcrumb) +
      codeBlock('robots', '🤖 robots.txt（允許 AI 搜尋爬蟲）', '放在網站根目錄 /robots.txt。', s.robots) +
      codeBlock('llms', '📄 llms.txt', '放在網站根目錄 /llms.txt，用 Markdown 向 AI 說明網站重點（新興標準）。', s.llms) +
      codeBlock('sitemap', '🗺️ sitemap.xml 範本', '放在網站根目錄 /sitemap.xml，並提交至 Google Search Console。', s.sitemap);
    renderFaqRows();
    $('#faqAdd').addEventListener('click', () => { faqItems.push({ q: '', a: '' }); renderFaqRows(); });
  }
  function renderFaqRows() {
    $('#faqRows').innerHTML = faqItems.map((f, i) => `
      <div class="faq-item">
        <div class="fields">
          <input class="input" data-fi="${i}" data-k="q" placeholder="問題 ${i + 1}，例如：服務費用怎麼計算？" value="${esc(f.q)}">
          <textarea class="input" data-fi="${i}" data-k="a" placeholder="答案：第一句直接回答…">${esc(f.a)}</textarea>
        </div>
        <button class="icon-btn" type="button" data-del="${i}" aria-label="刪除第 ${i + 1} 題" title="刪除">✕</button>
      </div>`).join('');
    $$('#faqRows [data-fi]').forEach(el => el.addEventListener('input', () => {
      faqItems[+el.dataset.fi][el.dataset.k] = el.value; updateFaqCode();
    }));
    $$('#faqRows [data-del]').forEach(b => b.addEventListener('click', () => {
      faqItems.splice(+b.dataset.del, 1); renderFaqRows();
    }));
    updateFaqCode();
  }
  function updateFaqCode() {
    $('#code-faq').textContent = '<script type="application/ld+json">\n' + A.faqJsonLd(faqItems) + '\n</script>';
    $('#code-faqhtml').textContent = A.faqHtml(faqItems);
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const pre = document.getElementById('code-' + b.dataset.copy);
    if (pre) copy(pre.textContent);
  });

  /* 原始資料 */
  function renderData() {
    const d = report.data;
    const row = (k, v) => `<tr><td class="k">${k}</td><td>${v || '<span class="muted">—</span>'}</td></tr>`;
    const tdk = `<div class="card"><h3>🏷️ TDK 與基本標籤</h3><div class="tbl-wrap"><table class="tbl">
      ${row('Title', esc(d.title) + (d.title ? ` <span class="muted small">(${d.title.length} 字 / 寬度 ${A.units(d.title)})</span>` : ''))}
      ${row('Description', esc(d.desc) + (d.desc ? ` <span class="muted small">(${d.desc.length} 字 / 寬度 ${A.units(d.desc)})</span>` : ''))}
      ${row('Keywords', esc(d.keywordsMeta))}
      ${row('Canonical', esc(d.canonical))}
      ${row('Robots', esc(d.robotsMeta))}
      ${row('Lang', esc(d.lang))}
      ${row('Viewport', esc(d.viewport))}
      ${row('最新日期', esc(d.latestDate))}
      ${Object.entries(d.og).map(([k, v]) => row(esc(k), esc(v))).join('')}
      ${Object.entries(d.tw).map(([k, v]) => row(esc(k), esc(v))).join('')}
    </table></div></div>`;

    const htree = `<div class="card"><h3>🔠 標題結構樹（${d.headings.length}）</h3><div class="htree">${d.headings.length ? d.headings.map(h =>
      `<div style="padding-left:${(h.level - 1) * 18}px"><span class="tag${h.skip ? ' skip' : ''}" title="${h.skip ? '階層跳級' : ''}">H${h.level}</span>${h.text ? esc(h.text) : '<span class="empty">（空白）</span>'}</div>`).join('') : '<p class="muted">沒有任何標題。</p>'}</div></div>`;

    const kws = `<div class="card"><h3>🔑 內容熱門詞（自動斷詞）</h3><div class="kw-cloud">${d.keywords.map(([w, c]) => `<span>${esc(w)}<b>${c}</b></span>`).join('') || '<span class="muted">—</span>'}</div>
      <p class="small muted" style="margin:10px 0 0">確認前幾名是否為你想排名的關鍵字；若不是，代表內容主題焦點可能需要調整。</p></div>`;

    const bots = d.bots ? `<div class="card"><h3>🤖 AI 爬蟲存取狀態</h3><div class="bot-grid">${d.bots.map(b =>
      `<div class="bot"><div><b>${esc(b.ua)}</b><small>${esc(b.owner)} · ${esc(b.use)}</small></div>
        <span class="s bg-${b.blocked ? (b.kind === 'search' ? 'bad' : 'warn') : 'good'}">${b.blocked ? '封鎖' : '允許'}</span></div>`).join('')}</div></div>` : '';

    const schema = `<div class="card"><h3>🧩 結構化資料（${d.schemaTypes.length ? esc(d.schemaTypes.join('、')) : '無'}）</h3>
      ${d.schemaErrors.length ? `<p class="c-bad small">${esc(d.schemaErrors.join('；'))}</p>` : ''}
      ${d.microdata.length ? `<p class="small">Microdata：${esc(d.microdata.join('、'))}</p>` : ''}
      ${d.ldRaw.length ? `<pre class="code">${esc(JSON.stringify(d.ldRaw.length === 1 ? d.ldRaw[0] : d.ldRaw, null, 2))}</pre>` : '<p class="muted">沒有 JSON-LD。</p>'}</div>`;

    const cit = d.citable.length ? `<div class="card"><h3>💬 可被 AI 引用的段落（${d.citable.length}）</h3>${d.citable.map(c =>
      `<div style="margin-bottom:10px"><b class="small">${esc(c.heading)}</b><div class="small muted">${esc(A.truncUnits(c.text, 260))}</div></div>`).join('')}</div>` : '';

    const imgs = d.imgList.length ? `<div class="card"><h3>🖼️ 圖片（${d.imgs}）</h3><div class="tbl-wrap"><table class="tbl">
      <tr><th>檔案</th><th>ALT</th><th>寬×高</th><th>lazy</th></tr>
      ${d.imgList.map(i => `<tr><td>${esc(i.src.split('/').pop().slice(0, 60))}</td><td>${i.alt == null ? '<span class="c-bad">缺少</span>' : i.alt === '' ? '<span class="muted">（空）</span>' : esc(i.alt)}</td><td>${i.w && i.h ? esc(i.w + '×' + i.h) : '<span class="c-warn">未設</span>'}</td><td>${i.lazy === 'lazy' ? '✓' : ''}</td></tr>`).join('')}
    </table></div></div>` : '';

    const links = d.linkList.length ? `<div class="card"><h3>🔗 連結（內部 ${d.internal}、外部 ${d.external}）</h3><div class="tbl-wrap" style="max-height:420px;overflow:auto"><table class="tbl">
      <tr><th>類型</th><th>錨點文字</th><th>網址</th></tr>
      ${d.linkList.map(l => `<tr><td>${l.internal ? '內部' : '外部'}${l.rel ? ` <span class="muted small">${esc(l.rel)}</span>` : ''}</td><td>${l.text ? esc(A.truncUnits(l.text, 60)) : '<span class="c-bad">（無文字）</span>'}</td><td class="small">${esc(l.href)}</td></tr>`).join('')}
    </table></div></div>` : '';

    $('#dataList').innerHTML = `<div class="two-col">${tdk}${htree}</div>${kws}${bots}${schema}${cit}${imgs}${links}`;
  }

  /* 分頁 */
  function switchTab(id) {
    $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === id));
  }
  $$('#tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  /* ---------- 匯出 ---------- */
  function toMarkdown(rep) {
    const d = rep.data;
    const L = [];
    L.push(`# SEO / GEO 健檢報告`, '');
    L.push(`- 網址：${d.url || '（貼上原始碼）'}`);
    if (rep.keyword) L.push(`- 目標關鍵字：${rep.keyword}`);
    L.push(`- 檢測時間：${new Date(rep.when).toLocaleString('zh-TW')}`, '');
    L.push(`## 分數總覽`, '', `| 指標 | 分數 | 等級 |`, `|---|---|---|`);
    L.push(`| 綜合 | ${rep.overall} | ${grade(rep.overall)} |`, `| SEO | ${rep.seoScore} | ${grade(rep.seoScore)} |`, `| GEO | ${rep.geoScore} | ${grade(rep.geoScore)} |`, '');
    L.push(`| 類別 | 權重 | 分數 |`, `|---|---|---|`);
    rep.categories.forEach(c => L.push(`| ${c.icon} ${c.name} | ${c.weight}% | ${c.score} |`));
    L.push('', '## 優先修正清單', '');
    rankedIssues().forEach((it, i) => L.push(`${i + 1}. **[P${priorityOf(it)}] ${it.k.title}**（${it.c.name}）— ${it.k.fix}`));
    L.push('', '## 詳細檢查', '');
    const mark = { pass: '✅', warn: '⚠️', fail: '❌', info: 'ℹ️' };
    rep.categories.forEach(c => {
      L.push(`### ${c.icon} ${c.name}（${c.score} 分）`, '');
      c.checks.forEach(k => {
        L.push(`- ${mark[k.status]} **${k.title}**：${k.detail}`);
        if (k.fix) L.push(`  - 建議：${k.fix}`);
      });
      L.push('');
    });
    L.push('## 標題結構', '');
    d.headings.forEach(h => L.push(`${'  '.repeat(h.level - 1)}- H${h.level} ${h.text || '（空白）'}`));
    return L.join('\n');
  }
  function fileBase() {
    let h = 'page';
    try { h = new URL(report.url).hostname.replace(/^www\./, ''); } catch (e) { }
    return `seo-geo-${h}-${new Date().toISOString().slice(0, 10)}`;
  }
  $('#mdBtn').addEventListener('click', () => report && download(fileBase() + '.md', toMarkdown(report), 'text/markdown;charset=utf-8'));
  $('#jsonBtn').addEventListener('click', () => report && download(fileBase() + '.json', JSON.stringify(report, null, 2), 'application/json'));
  $('#printBtn').addEventListener('click', () => {
    renderChecks('all');
    $$('#checkList details').forEach(d => d.open = true);
    window.print();
  });
  window.addEventListener('beforeprint', () => $$('#checkList details').forEach(d => d.open = true));

  // 支援 ?url= 參數直接檢測
  const qp = new URLSearchParams(location.search);
  if (qp.get('url')) {
    $('#urlInput').value = qp.get('url');
    if (qp.get('kw')) $('#kwInput').value = qp.get('kw');
    runAudit();
  }
})();
