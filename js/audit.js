/* ==========================================================
   SEO / GEO 健檢引擎
   輸入：HTML 字串 + 輔助檔案（robots.txt / sitemap.xml / llms.txt）
   輸出：分類評分、檢查項目、原始資料、建議程式碼
   ========================================================== */
(function (global) {
  'use strict';

  /* ---------- 文字工具 ---------- */
  const CJK_ONE = /[⺀-鿿가-힯豈-﫿＀-￯]/;
  const CJK_ALL = /[⺀-鿿가-힯豈-﫿＀-￯]/g;

  // 顯示寬度：中日韓全形字 = 2，其餘 = 1（近似 Google 的像素截斷）
  function units(s) {
    if (!s) return 0;
    let n = 0;
    for (const ch of s) n += CJK_ONE.test(ch) ? 2 : 1;
    return n;
  }
  // 字數：中文以字計、英文以詞計
  function wordCount(s) {
    if (!s) return 0;
    const cjk = (s.match(CJK_ALL) || []).length;
    const latin = (s.replace(CJK_ALL, ' ').match(/[A-Za-z0-9][A-Za-z0-9'’\-]*/g) || []).length;
    return cjk + latin;
  }
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function truncUnits(s, max) {
    let n = 0, out = '';
    for (const ch of s) {
      n += CJK_ONE.test(ch) ? 2 : 1;
      if (n > max) return out.trimEnd() + '…';
      out += ch;
    }
    return out;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function absUrl(href, base) {
    try { return new URL(href, base).href; } catch (e) { return null; }
  }
  function isQuestion(s) {
    s = clean(s);
    return /[?？]$/.test(s) ||
      /^(什麼|甚麼|如何|怎麼|怎樣|為什麼|為何|哪些|哪裡|哪個|是否|可以|能否|多少|何時|誰)/.test(s) ||
      /(是什麼|是甚麼|嗎|呢|如何|怎麼做|多少錢|哪裡買)$/.test(s) ||
      /^(what|how|why|when|where|which|who|can|is|are|do|does|should)\b/i.test(s);
  }

  /* ---------- 關鍵字萃取 ---------- */
  const STOP = new Set(('的 了 和 與 及 或 是 在 有 我 你 他 她 它 我們 你們 他們 這 那 這個 那個 一個 也 都 就 而 並 但 及其 以及 可以 如果 因為 所以 為 對 於 從 到 被 把 讓 給 等 之 其 中 上 下 個 嗎 呢 吧 啊 喔 更 很 最 還 又 再 已 已經 不 沒 沒有 會 能 要 將 以 由 此 該 各 每 些 什麼 如何 我們的 您 您的 請 點 頁 首頁 更多 ' +
    'the a an and or of to in on for with by at from is are be was were it this that these those as your you we our us they their not but if then so do does can will just more about into over than also its use using how what why when which who').split(/\s+/));
  function topKeywords(text, limit) {
    const counts = new Map();
    const add = w => {
      w = w.toLowerCase();
      if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) return;
      counts.set(w, (counts.get(w) || 0) + 1);
    };
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const seg = new Intl.Segmenter('zh-Hant', { granularity: 'word' });
        for (const s of seg.segment(text)) if (s.isWordLike) add(s.segment);
      } else throw 0;
    } catch (e) {
      (text.match(/[A-Za-z][A-Za-z\-]+/g) || []).forEach(add);
      const cjk = text.match(/[一-鿿]+/g) || [];
      cjk.forEach(run => { for (let i = 0; i < run.length - 1; i++) add(run.substr(i, 2)); });
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit || 15);
  }
  function countOccur(hay, needle) {
    if (!needle) return 0;
    hay = hay.toLowerCase(); needle = needle.toLowerCase();
    let n = 0, i = 0;
    while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
    return n;
  }

  /* ---------- robots.txt ---------- */
  function parseRobots(txt) {
    const groups = [], sitemaps = [];
    let cur = null, lastUA = false;
    (txt || '').split(/\r?\n/).forEach(raw => {
      const line = raw.replace(/#.*$/, '').trim();
      if (!line) return;
      const i = line.indexOf(':');
      if (i < 0) return;
      const k = line.slice(0, i).trim().toLowerCase();
      const v = line.slice(i + 1).trim();
      if (k === 'user-agent') {
        if (!cur || !lastUA) { cur = { agents: [], rules: [] }; groups.push(cur); }
        cur.agents.push(v.toLowerCase());
        lastUA = true;
      } else if (k === 'allow' || k === 'disallow') {
        if (cur) cur.rules.push({ type: k, path: v });
        lastUA = false;
      } else if (k === 'sitemap') {
        sitemaps.push(v); lastUA = false;
      } else lastUA = false;
    });
    return { groups, sitemaps };
  }
  function robotsMatch(path, pattern) {
    const re = '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$');
    try { return new RegExp(re).test(path); } catch (e) { return path.startsWith(pattern); }
  }
  function robotsBlocked(robots, agent, path) {
    const a = agent.toLowerCase();
    let g = robots.groups.find(g => g.agents.includes(a));
    let specific = !!g;
    if (!g) g = robots.groups.find(g => g.agents.includes('*'));
    if (!g) return { blocked: false, specific: false };
    let best = null;
    g.rules.forEach(r => {
      if (!r.path) return;
      if (robotsMatch(path, r.path)) {
        if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.type === 'allow')) best = r;
      }
    });
    return { blocked: !!best && best.type === 'disallow', specific, rule: best };
  }

  const AI_BOTS = [
    { ua: 'OAI-SearchBot', owner: 'OpenAI', use: 'ChatGPT 搜尋', kind: 'search' },
    { ua: 'ChatGPT-User', owner: 'OpenAI', use: '使用者觸發瀏覽（官方：robots.txt 可能不適用）', kind: 'user' },
    { ua: 'GPTBot', owner: 'OpenAI', use: '模型訓練', kind: 'train' },
    { ua: 'Claude-SearchBot', owner: 'Anthropic', use: 'Claude 搜尋', kind: 'search' },
    { ua: 'Claude-User', owner: 'Anthropic', use: '使用者觸發瀏覽', kind: 'user' },
    { ua: 'ClaudeBot', owner: 'Anthropic', use: '模型訓練', kind: 'train' },
    { ua: 'PerplexityBot', owner: 'Perplexity', use: 'Perplexity 搜尋', kind: 'search' },
    { ua: 'Perplexity-User', owner: 'Perplexity', use: '使用者觸發（官方：通常不遵守 robots.txt）', kind: 'user' },
    { ua: 'Googlebot', owner: 'Google', use: '搜尋 + AI Overviews', kind: 'search' },
    { ua: 'Google-Extended', owner: 'Google', use: 'Gemini 訓練與接地（不影響 Google 搜尋）', kind: 'train' },
    { ua: 'Bingbot', owner: 'Microsoft', use: 'Bing + Copilot', kind: 'search' },
    { ua: 'Applebot-Extended', owner: 'Apple', use: 'Apple Intelligence', kind: 'train' },
    { ua: 'CCBot', owner: 'Common Crawl', use: '開放資料集', kind: 'train' },
    { ua: 'Meta-ExternalAgent', owner: 'Meta', use: 'Meta AI', kind: 'train' }
  ];

  /* ---------- Schema 工具 ---------- */
  function flattenSchema(obj, out) {
    out = out || [];
    if (Array.isArray(obj)) { obj.forEach(o => flattenSchema(o, out)); return out; }
    if (!obj || typeof obj !== 'object') return out;
    if (obj['@graph']) flattenSchema(obj['@graph'], out);
    if (obj['@type']) out.push(obj);
    Object.keys(obj).forEach(k => {
      if (k === '@graph') return;
      const v = obj[k];
      if (v && typeof v === 'object') {
        (Array.isArray(v) ? v : [v]).forEach(x => { if (x && typeof x === 'object' && x['@type']) flattenSchema(x, out); });
      }
    });
    return out;
  }
  function typesOf(o) { const t = o['@type']; return (Array.isArray(t) ? t : [t]).map(String); }
  function hasType(o, names) { return typesOf(o).some(t => names.includes(t)); }

  const SCHEMA_REQ = {
    Organization: { req: ['name', 'url'], rec: ['logo', 'sameAs', 'contactPoint', 'description'] },
    LocalBusiness: { req: ['name', 'address'], rec: ['telephone', 'openingHoursSpecification', 'geo', 'url', 'image', 'priceRange'] },
    WebSite: { req: ['name', 'url'], rec: ['potentialAction', 'inLanguage'] },
    WebPage: { req: ['name'], rec: ['description', 'url', 'inLanguage'] },
    Article: { req: ['headline'], rec: ['author', 'datePublished', 'dateModified', 'image', 'publisher'] },
    BlogPosting: { req: ['headline'], rec: ['author', 'datePublished', 'dateModified', 'image', 'publisher'] },
    NewsArticle: { req: ['headline'], rec: ['author', 'datePublished', 'dateModified', 'image', 'publisher'] },
    Product: { req: ['name'], rec: ['image', 'description', 'offers', 'brand', 'aggregateRating', 'review', 'sku'] },
    BreadcrumbList: { req: ['itemListElement'], rec: [] },
    FAQPage: { req: ['mainEntity'], rec: [] },
    HowTo: { req: ['name', 'step'], rec: ['totalTime', 'image'] },
    Person: { req: ['name'], rec: ['url', 'sameAs', 'jobTitle', 'image'] },
    Event: { req: ['name', 'startDate', 'location'], rec: ['endDate', 'offers', 'image', 'description'] },
    Recipe: { req: ['name', 'recipeIngredient', 'recipeInstructions'], rec: ['image', 'author', 'totalTime', 'nutrition'] },
    Service: { req: ['name'], rec: ['provider', 'areaServed', 'description', 'offers'] },
    VideoObject: { req: ['name', 'thumbnailUrl', 'uploadDate'], rec: ['description', 'duration', 'contentUrl'] }
  };
  const LOCAL_TYPES = ['LocalBusiness', 'Restaurant', 'Store', 'MedicalBusiness', 'Dentist', 'LegalService', 'ProfessionalService', 'HomeAndConstructionBusiness', 'AutoRepair', 'BeautySalon', 'HealthAndBeautyBusiness', 'FoodEstablishment', 'CafeOrCoffeeShop', 'Hotel', 'LodgingBusiness', 'RealEstateAgent', 'TravelAgency', 'EducationalOrganization'];

  /* ---------- FAQ 偵測 ---------- */
  function detectFaqs(doc, schemaFaqs) {
    const out = [], seen = new Set();
    const push = (q, a, src) => {
      q = clean(q); a = clean(a);
      if (!q || !a || a.length < 4) return;
      const key = q.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ q, a: a.length > 1200 ? a.slice(0, 1200) + '…' : a, src });
    };
    schemaFaqs.forEach(f => push(f.q, f.a, 'Schema'));
    doc.querySelectorAll('details').forEach(d => {
      const s = d.querySelector('summary');
      if (!s) return;
      const clone = d.cloneNode(true);
      clone.querySelector('summary').remove();
      push(s.textContent, clone.textContent, '<details>');
    });
    doc.querySelectorAll('dl').forEach(dl => {
      dl.querySelectorAll('dt').forEach(dt => {
        const dd = dt.nextElementSibling;
        if (dd && dd.tagName === 'DD' && isQuestion(dt.textContent)) push(dt.textContent, dd.textContent, '<dl>');
      });
    });
    doc.querySelectorAll('h2,h3,h4,h5,h6,strong,b').forEach(h => {
      const q = clean(h.textContent);
      if (!q || q.length > 140 || !isQuestion(q)) return;
      let block = h.tagName === 'STRONG' || h.tagName === 'B' ? h.parentElement : h;
      if (!block) return;
      let a = '', el = block.nextElementSibling, guard = 0;
      while (el && guard++ < 6 && !/^H[1-6]$/.test(el.tagName) && a.length < 900) {
        if (el.querySelector && el.querySelector('h1,h2,h3,h4,h5,h6')) break;
        a += ' ' + el.textContent;
        el = el.nextElementSibling;
      }
      if (!a.trim() && block !== h) {
        a = block.textContent.replace(h.textContent, '');
      }
      push(q, a, '<' + h.tagName.toLowerCase() + '>');
    });
    return out.slice(0, 30);
  }

  /* ==========================================================
     主程式
     ========================================================== */
  function run(html, ctx) {
    ctx = ctx || {};
    const url = ctx.url || '';
    let base = url;
    const keyword = clean(ctx.keyword || '');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const baseEl = doc.querySelector('base[href]');
    if (baseEl && url) base = absUrl(baseEl.getAttribute('href'), url) || url;
    let urlObj = null;
    try { urlObj = url ? new URL(url) : null; } catch (e) { urlObj = null; }

    const $ = s => doc.querySelector(s);
    const $$ = s => Array.from(doc.querySelectorAll(s));
    const meta = (name) => {
      const el = doc.querySelector(`meta[name="${name}" i]`) || doc.querySelector(`meta[property="${name}" i]`);
      return el ? clean(el.getAttribute('content')) : '';
    };

    /* ----- 原始資料 ----- */
    const titles = $$('title').filter(t => !t.closest('svg'));
    const title = titles.length ? clean(titles[0].textContent) : '';
    const descEls = $$('meta[name="description" i]');
    const desc = descEls.length ? clean(descEls[0].getAttribute('content')) : '';
    const keywordsMeta = meta('keywords');
    const robotsMeta = (meta('robots') + ',' + meta('googlebot')).toLowerCase();
    const canonicalEl = $('link[rel~="canonical" i]');
    const canonical = canonicalEl ? canonicalEl.getAttribute('href') || '' : '';
    const lang = (doc.documentElement.getAttribute('lang') || '').trim();
    const charset = $('meta[charset]') || $('meta[http-equiv="content-type" i]');
    const viewport = meta('viewport');
    const favicon = $('link[rel~="icon" i]') || $('link[rel="shortcut icon" i]') || $('link[rel="apple-touch-icon" i]');
    const hreflangs = $$('link[rel="alternate" i][hreflang]').map(l => ({ lang: l.getAttribute('hreflang'), href: l.getAttribute('href') }));
    const og = {};
    $$('meta[property^="og:" i]').forEach(m => { og[m.getAttribute('property').toLowerCase()] = clean(m.getAttribute('content')); });
    const tw = {};
    $$('meta[name^="twitter:" i], meta[property^="twitter:" i]').forEach(m => { tw[(m.getAttribute('name') || m.getAttribute('property')).toLowerCase()] = clean(m.getAttribute('content')); });

    // 本文文字（移除非內容元素）
    const body = doc.body ? doc.body.cloneNode(true) : doc.createElement('body');
    body.querySelectorAll('script,style,noscript,template,svg,iframe,canvas').forEach(e => e.remove());
    const mainEl = body.querySelector('main, article, [role="main"]');
    const bodyText = clean(body.textContent);
    const contentText = clean((mainEl || body).textContent);
    const words = wordCount(bodyText);
    const htmlSize = new Blob([html]).size;
    const textRatio = htmlSize ? (new Blob([bodyText]).size / htmlSize) * 100 : 0;

    // 標題
    const headings = $$('h1,h2,h3,h4,h5,h6').map(h => ({ level: +h.tagName[1], text: clean(h.textContent), el: h }));
    const h1s = headings.filter(h => h.level === 1);
    const h2s = headings.filter(h => h.level === 2);
    let skips = [];
    let prev = 0;
    headings.forEach(h => {
      h.skip = prev && h.level > prev + 1;
      if (h.skip) skips.push(`H${prev} → H${h.level}「${truncUnits(h.text, 30)}」`);
      prev = h.level;
    });
    const emptyHeadings = headings.filter(h => !h.text);
    const questionHeadings = headings.filter(h => h.level >= 2 && isQuestion(h.text));

    // 段落 / 清單 / 表格
    const paragraphs = $$('p').map(p => clean(p.textContent)).filter(t => t.length > 0);
    const lists = $$('ul,ol').filter(l => !l.closest('nav,header,footer') && l.querySelectorAll('li').length >= 2);
    const tables = $$('table').filter(t => t.querySelectorAll('tr').length >= 2);

    // 圖片
    const imgs = $$('img');
    const imgNoAlt = imgs.filter(i => !i.hasAttribute('alt'));
    const imgEmptyAlt = imgs.filter(i => i.hasAttribute('alt') && !i.getAttribute('alt').trim());
    const imgNoDim = imgs.filter(i => !(i.hasAttribute('width') && i.hasAttribute('height')));
    const imgLazy = imgs.filter(i => (i.getAttribute('loading') || '').toLowerCase() === 'lazy');
    const imgModern = imgs.filter(i => /\.(webp|avif)(\?|$)/i.test(i.getAttribute('src') || '') || (i.closest('picture') && i.closest('picture').querySelector('source[type*="webp"],source[type*="avif"]')));
    const imgSrc = i => i.getAttribute('src') || i.getAttribute('data-src') || '';

    // 連結
    const links = $$('a[href]').map(a => {
      const href = a.getAttribute('href').trim();
      const abs = absUrl(href, base || 'https://example.invalid/');
      let internal = false;
      try { internal = abs && (base ? new URL(abs).hostname === new URL(base).hostname : !/^https?:/i.test(href)); } catch (e) { }
      const text = clean(a.textContent) || clean(a.getAttribute('aria-label')) || clean((a.querySelector('img[alt]') || {}).alt || '');
      return {
        href, abs, internal, text,
        rel: (a.getAttribute('rel') || '').toLowerCase(),
        blank: (a.getAttribute('target') || '').toLowerCase() === '_blank',
        js: /^javascript:/i.test(href),
        anchor: href.startsWith('#'),
        mailto: /^(mailto|tel):/i.test(href)
      };
    });
    const realLinks = links.filter(l => !l.js && !l.anchor && !l.mailto);
    const internalLinks = realLinks.filter(l => l.internal);
    const externalLinks = realLinks.filter(l => !l.internal);
    const emptyAnchor = realLinks.filter(l => !l.text);
    const generic = /^(點此|點這裡|按此|按這裡|這裡|更多|了解更多|read more|click here|here|more|learn more|詳細|詳情|>>|»)$/i;
    const genericAnchor = realLinks.filter(l => l.text && generic.test(l.text));
    const unsafeBlank = realLinks.filter(l => l.blank && !/noopener|noreferrer/.test(l.rel) && !l.internal);
    const nofollow = realLinks.filter(l => /nofollow|sponsored|ugc/.test(l.rel));
    const authorityLinks = externalLinks.filter(l => /\.(gov|edu)(\.[a-z]{2})?\/|\.gov\.tw|\.edu\.tw|wikipedia\.org|who\.int|oecd\.org|un\.org|w3\.org|ietf\.org|iso\.org|statista\.com|arxiv\.org|doi\.org|nature\.com|sciencedirect|pubmed|ncbi\.nlm/i.test(l.abs || ''));

    // 結構化資料
    const ldBlocks = $$('script[type="application/ld+json" i]');
    const schemaErrors = [];
    const ldRaw = [];
    let schemaItems = [];
    ldBlocks.forEach((s, i) => {
      const txt = s.textContent.trim();
      try {
        const j = JSON.parse(txt);
        ldRaw.push(j);
        schemaItems = schemaItems.concat(flattenSchema(j));
      } catch (e) {
        schemaErrors.push(`第 ${i + 1} 段 JSON-LD 解析失敗：${e.message}`);
      }
    });
    const microdata = $$('[itemscope][itemtype]').map(e => (e.getAttribute('itemtype') || '').split('/').pop());
    const rdfa = $$('[typeof]').map(e => e.getAttribute('typeof'));
    const schemaTypes = [...new Set(schemaItems.flatMap(typesOf))];
    const ctxOk = ldRaw.every(j => {
      const c = Array.isArray(j) ? (j[0] || {})['@context'] : j['@context'];
      return c && /schema\.org/i.test(JSON.stringify(c));
    });

    // FAQPage
    const faqSchemas = schemaItems.filter(o => hasType(o, ['FAQPage']));
    const schemaFaqs = [];
    const faqIssues = [];
    faqSchemas.forEach(f => {
      let me = f.mainEntity;
      if (!me) { faqIssues.push('FAQPage 缺少 mainEntity'); return; }
      if (!Array.isArray(me)) me = [me];
      me.forEach((q, i) => {
        if (!q || !hasType(q, ['Question'])) { faqIssues.push(`第 ${i + 1} 題 @type 不是 Question`); return; }
        const ans = Array.isArray(q.acceptedAnswer) ? q.acceptedAnswer[0] : q.acceptedAnswer;
        const qName = clean(q.name);
        const aText = ans ? clean(String(ans.text || '').replace(/<[^>]+>/g, ' ')) : '';
        if (!qName) faqIssues.push(`第 ${i + 1} 題缺少 name（問題文字）`);
        if (!ans) faqIssues.push(`第 ${i + 1} 題缺少 acceptedAnswer`);
        else if (!aText) faqIssues.push(`第 ${i + 1} 題 acceptedAnswer 缺少 text`);
        if (qName && aText) schemaFaqs.push({ q: qName, a: aText });
      });
    });
    const faqVisible = schemaFaqs.filter(f => bodyText.toLowerCase().includes(f.q.toLowerCase().slice(0, 18)));
    const detectedFaqs = detectFaqs(doc, schemaFaqs);

    // 作者 / 日期
    const schemaAuthor = schemaItems.some(o => o.author) || schemaItems.some(o => hasType(o, ['Person']));
    const authorMeta = meta('author') || meta('article:author');
    const relAuthor = $('a[rel~="author"], [itemprop="author"], .author, .byline, [class*="author" i]');
    const hasAuthor = !!(schemaAuthor || authorMeta || relAuthor || /作者[:：]|撰文|文\s*[\/／]|by\s+[A-Z][a-z]+/.test(contentText.slice(0, 3000)));
    const dateCandidates = [];
    schemaItems.forEach(o => { ['dateModified', 'datePublished', 'uploadDate'].forEach(k => { if (o[k]) dateCandidates.push(String(o[k])); }); });
    ['article:modified_time', 'article:published_time', 'og:updated_time', 'last-modified', 'date'].forEach(k => { const v = meta(k); if (v) dateCandidates.push(v); });
    $$('time[datetime]').forEach(t => dateCandidates.push(t.getAttribute('datetime')));
    const dates = dateCandidates.map(d => new Date(d)).filter(d => !isNaN(d) && d.getFullYear() > 1995 && d.getTime() < Date.now() + 864e5 * 2);
    const latestDate = dates.length ? new Date(Math.max(...dates)) : null;
    const ageDays = latestDate ? Math.round((Date.now() - latestDate) / 864e5) : null;

    // 實體 sameAs
    const sameAs = [];
    schemaItems.filter(o => hasType(o, ['Organization', 'Person', 'Corporation', ...LOCAL_TYPES])).forEach(o => {
      const s = o.sameAs; if (s) (Array.isArray(s) ? s : [s]).forEach(x => sameAs.push(String(x)));
    });

    // 統計數據 / 定義句
    const statMatches = contentText.match(/\d[\d,.]*\s?(%|％|倍|萬|億|千|百萬|元|美元|台幣|人|次|小時|分鐘|天|年|個月|公斤|公里|kg|km|ms|GB|MB|USD|NTD)/gi) || [];
    const yearMatches = contentText.match(/(19|20)\d{2}\s?年|\b(19|20)\d{2}\b/g) || [];
    const paraText = paragraphs.join('\n');
    const definitionSentences = (paraText.match(/[^。！？.!?\n]{2,40}(是一種|是指|指的是|意指|定義為|是一個|就是)[^。！？.!?\n]{4,120}[。.!！]?/g) || [])
      .concat(paraText.match(/\b[A-Z][\w\s-]{1,40}\s(is an?|refers to|means)\s[^.]{10,160}\./g) || []);

    // 可引用段落（answer-first：40–160 字、跟在 H2/H3 之後）
    const citable = [];
    $$('h2,h3').forEach(h => {
      let el = h.nextElementSibling;
      while (el && !/^(P|DIV|UL|OL|SECTION)$/.test(el.tagName)) el = el.nextElementSibling;
      if (!el || /^H[1-6]$/.test(el.tagName)) return;
      const p = el.tagName === 'P' ? el : el.querySelector('p') || el;
      const t = clean(p.textContent);
      const w = wordCount(t);
      if (w >= 40 && w <= 220) citable.push({ heading: clean(h.textContent), text: t, words: w });
    });

    // 效能
    const scripts = $$('script[src]');
    const headScripts = $$('head script[src]').filter(s => !s.hasAttribute('async') && !s.hasAttribute('defer') && (s.getAttribute('type') || '').toLowerCase() !== 'module');
    const stylesheets = $$('link[rel~="stylesheet" i]');
    const inlineScriptSize = $$('script:not([src])').reduce((n, s) => n + s.textContent.length, 0);
    const inlineStyleSize = $$('style').reduce((n, s) => n + s.textContent.length, 0);
    const preconnect = $$('link[rel~="preconnect" i], link[rel~="dns-prefetch" i], link[rel~="preload" i]');
    const iframes = $$('iframe');

    // SPA 偵測
    const spaRoot = $('#root, #app, #__next, #__nuxt, [data-reactroot], app-root');
    const isCsrShell = words < 80 && scripts.length > 0 && !!spaRoot;

    /* ==========================================================
       評分
       ========================================================== */
    const cats = [];
    function cat(id, name, icon, weight, group, desc) {
      const c = { id, name, icon, weight, group, desc, checks: [] };
      cats.push(c);
      return c;
    }
    // 依據來源：g = Google / 官方文件明文規範、p = 業界最佳實務、h = 經驗值（無官方數字）
    const BASIS = {
      title: 'g', desc: 'g', 'title-multi': 'p', 'desc-multi': 'p', keywords: 'g', 'td-same': 'p',
      'title-len': 'h', 'desc-len': 'h', 'kw-title': 'p', 'kw-desc': 'p',
      h1: 'p', 'h1-len': 'h', 'h1-kw': 'p', 'h1-title': 'p', h2: 'p', 'h-skip': 'p', 'h-empty': 'p', 'h-kw': 'p',
      ld: 'g', 'ld-valid': 'g', 'ld-ctx': 'g', org: 'g', website: 'g', breadcrumb: 'g', 'ld-fields': 'g',
      'faq-schema': 'g', 'faq-valid': 'g', 'faq-visible': 'g', 'faq-note': 'g', 'faq-count': 'h', 'faq-depth': 'h', 'faq-content': 'p',
      words: 'h', ratio: 'h', paras: 'p', 'long-para': 'h', lists: 'p', 'kw-density': 'g', 'kw-first': 'h', readability: 'h',
      'img-none': 'p', alt: 'g', dim: 'g', lazy: 'g', format: 'g',
      internal: 'g', external: 'p', anchor: 'g', jslink: 'g',
      https: 'g', noindex: 'g', canonical: 'g', viewport: 'g', lang: 'p', charset: 'p', doctype: 'p', favicon: 'g', hreflang: 'g', url: 'g',
      robots: 'g', 'robots-sm': 'g', sitemap: 'g', deprecated: 'p', semantic: 'p',
      og: 'p', 'og-img': 'p', twitter: 'p', 'site-name': 'g',
      'ai-bots': 'g', 'ai-train': 'g', nosnippet: 'g', llms: 'h', ssr: 'p', 'q-heading': 'h', citable: 'h', stats: 'h', 'cite-src': 'p',
      author: 'p', fresh: 'p', entity: 'p', define: 'h', struct: 'p',
      'gsc-ai': 'g', 'html-size': 'h', blocking: 'g', requests: 'h', inline: 'h', hints: 'p', ttfb: 'h'
    };
    const GEN_AI = 'https://developers.google.com/search/docs/fundamentals/ai-optimization-guide';
    const SD = 'https://developers.google.com/search/docs/appearance/structured-data/';
    const SOURCES = {
      title: 'https://developers.google.com/search/docs/appearance/title-link', 'title-len': 'https://developers.google.com/search/docs/appearance/title-link',
      desc: 'https://developers.google.com/search/docs/appearance/snippet', 'desc-len': 'https://developers.google.com/search/docs/appearance/snippet',
      keywords: 'https://developers.google.com/search/blog/2009/09/google-does-not-use-keywords-meta-tag',
      ld: SD + 'intro-structured-data', 'ld-valid': SD + 'intro-structured-data', 'ld-ctx': SD + 'intro-structured-data', 'ld-fields': SD + 'search-gallery',
      org: SD + 'organization', entity: SD + 'organization', website: 'https://developers.google.com/search/docs/appearance/site-names', 'site-name': 'https://developers.google.com/search/docs/appearance/site-names',
      breadcrumb: SD + 'breadcrumb', 'faq-visible': SD + 'sd-policies',
      'faq-schema': 'https://developers.google.com/search/updates', 'faq-note': 'https://developers.google.com/search/updates',
      words: GEN_AI + '#mythbusting', citable: GEN_AI + '#mythbusting', llms: GEN_AI + '#mythbusting', 'gsc-ai': GEN_AI,
      'kw-density': 'https://developers.google.com/search/docs/essentials/spam-policies',
      alt: 'https://developers.google.com/search/docs/appearance/google-images', format: 'https://developers.google.com/search/docs/appearance/google-images',
      dim: 'https://web.dev/articles/optimize-cls', lazy: 'https://web.dev/articles/browser-level-image-lazy-loading',
      internal: 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable', anchor: 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable', jslink: 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable',
      https: 'https://developers.google.com/search/docs/appearance/page-experience', noindex: 'https://developers.google.com/search/docs/crawling-indexing/block-indexing',
      canonical: 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
      viewport: 'https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing',
      favicon: 'https://developers.google.com/search/docs/appearance/favicon-in-search', hreflang: 'https://developers.google.com/search/docs/specialty/international/localized-versions',
      url: 'https://developers.google.com/search/docs/crawling-indexing/url-structure', robots: 'https://developers.google.com/search/docs/crawling-indexing/robots/intro',
      'robots-sm': 'https://developers.google.com/search/docs/crawling-indexing/robots/intro', sitemap: 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview',
      og: 'https://ogp.me/', nosnippet: 'https://developers.google.com/search/docs/appearance/ai-features',
      ssr: 'https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics',
      stats: 'https://arxiv.org/abs/2311.09735', 'cite-src': 'https://arxiv.org/abs/2311.09735',
      author: 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content', fresh: 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
      'ai-bots': ['https://developers.openai.com/api/docs/bots', 'https://support.claude.com/en/articles/8896518-what-is-claudebot', 'https://docs.perplexity.ai/guides/bots'],
      'ai-train': ['https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers', 'https://developers.openai.com/api/docs/bots']
    };
    function add(c, o) {
      o.basis = BASIS[o.id] || 'p';
      if (SOURCES[o.id]) o.src = [].concat(SOURCES[o.id]);
      const max = o.status === 'info' ? 0 : (o.max == null ? 5 : o.max);
      let score = o.score;
      if (score == null) score = o.status === 'pass' ? max : o.status === 'warn' ? Math.round(max * 0.5) : 0;
      c.checks.push(Object.assign({ impact: 'medium', fix: '' }, o, { max, score }, (o.status === 'pass' || o.status === 'info') ? { fix: '' } : {}));
    }
    const kw = keyword.toLowerCase();
    const kwIn = s => kw && s.toLowerCase().includes(kw);

    /* ---- 1. TDK ---- */
    const cT = cat('tdk', 'TDK 標題與描述', '🏷️', 13, 'seo', 'Title / Description / Keywords');
    const tU = units(title);
    if (!title) add(cT, { id: 'title', title: '頁面標題 <title>', status: 'fail', max: 10, impact: 'high', detail: '找不到 <title> 標籤。', fix: '在 <head> 加入獨一無二、含核心關鍵字的 <title>，建議 15–30 個中文字（約 30–60 字元）。' });
    else {
      add(cT, { id: 'title', title: '頁面標題 <title>', status: 'pass', max: 4, detail: `「${title}」` });
      const st = tU >= 30 && tU <= 60 ? 'pass' : (tU >= 20 && tU <= 70 ? 'warn' : 'fail');
      add(cT, {
        id: 'title-len', title: '標題長度', status: st, max: 6, impact: 'high',
        detail: `寬度 ${tU}（中文字=2），建議 30–60。${tU > 60 ? 'Google 搜尋結果可能被截斷。' : tU < 30 ? '偏短，可能浪費關鍵字曝光空間。' : ''}`,
        fix: st === 'pass' ? '' : '調整為 15–30 個中文字或 50–60 個英文字元；把核心關鍵字放在前段，品牌名放最後（例：主要關鍵字｜次要描述 - 品牌）。'
      });
    }
    if (titles.length > 1) add(cT, { id: 'title-multi', title: '多個 <title>', status: 'warn', max: 2, detail: `發現 ${titles.length} 個 <title>，搜尋引擎只會採用其中一個。`, fix: '保留一個 <title>，移除重複。' });
    if (!desc) add(cT, { id: 'desc', title: 'Meta Description', status: 'fail', max: 10, impact: 'high', detail: '找不到 meta description。', fix: '加入 <meta name="description" content="…">，約 60–80 個中文字，說明頁面價值並包含關鍵字與行動呼籲。' });
    else {
      const dU = units(desc);
      add(cT, { id: 'desc', title: 'Meta Description', status: 'pass', max: 4, detail: `「${truncUnits(desc, 200)}」` });
      const st = dU >= 100 && dU <= 165 ? 'pass' : (dU >= 50 && dU <= 200 ? 'warn' : 'fail');
      add(cT, {
        id: 'desc-len', title: '描述長度', status: st, max: 6, impact: 'medium',
        detail: `寬度 ${dU}，建議 100–160（約 50–80 中文字）。`,
        fix: st === 'pass' ? '' : (dU > 165 ? '精簡描述，重要資訊放前 70 個中文字內，避免被截斷。' : '擴充描述內容，加入具體利益點、數字或行動呼籲。')
      });
    }
    if (descEls.length > 1) add(cT, { id: 'desc-multi', title: '多個 Meta Description', status: 'warn', max: 2, detail: `發現 ${descEls.length} 個 description。`, fix: '只保留一個 meta description。' });
    if (keyword) {
      add(cT, { id: 'kw-title', title: `標題包含目標關鍵字「${keyword}」`, status: kwIn(title) ? (title.toLowerCase().indexOf(kw) <= Math.max(10, title.length * 0.4) ? 'pass' : 'warn') : 'fail', max: 6, impact: 'high', detail: kwIn(title) ? (title.toLowerCase().indexOf(kw) <= Math.max(10, title.length * 0.4) ? '關鍵字位於標題前段。' : '有包含，但位置偏後。') : '標題未出現目標關鍵字。', fix: '將目標關鍵字放在 <title> 的前段。' });
      add(cT, { id: 'kw-desc', title: `描述包含目標關鍵字`, status: kwIn(desc) ? 'pass' : 'warn', max: 3, detail: kwIn(desc) ? '描述中有出現關鍵字（搜尋時會被加粗顯示）。' : '描述未出現目標關鍵字。', fix: '在 meta description 中自然帶入關鍵字。' });
    }
    if (!keywordsMeta) add(cT, { id: 'keywords', title: 'Meta Keywords', status: 'info', detail: '未設定。Google 已不採用 meta keywords 作為排名因子，可不設定；部分在地搜尋引擎仍會參考。' });
    else {
      const kwList = keywordsMeta.split(/[,，、]/).map(clean).filter(Boolean);
      add(cT, { id: 'keywords', title: 'Meta Keywords', status: kwList.length > 12 ? 'warn' : 'pass', max: 2, impact: 'low', detail: `${kwList.length} 個：${kwList.slice(0, 12).join('、')}${kwList.length > 12 ? '…' : ''}`, fix: kwList.length > 12 ? '關鍵字過多易被視為堆砌，保留 5–10 個最相關的即可。' : '' });
    }
    if (title && desc && title === desc) add(cT, { id: 'td-same', title: '標題與描述重複', status: 'warn', max: 3, detail: 'Title 與 Description 內容完全相同。', fix: '描述應補充標題沒說到的價值資訊。' });

    /* ---- 2. Headings ---- */
    const cH = cat('headings', 'H 標籤結構', '🔠', 10, 'seo', 'H1–H6 階層與語意');
    if (h1s.length === 1) add(cH, { id: 'h1', title: 'H1 數量', status: 'pass', max: 8, detail: `1 個 H1：「${h1s[0].text}」` });
    else if (h1s.length === 0) add(cH, { id: 'h1', title: 'H1 數量', status: 'fail', max: 8, impact: 'high', detail: '頁面沒有 H1。', fix: '每頁加入一個描述頁面主題的 <h1>，通常與 <title> 相近但可更口語。' });
    else add(cH, { id: 'h1', title: 'H1 數量', status: 'warn', max: 8, score: 6, impact: 'low', detail: `發現 ${h1s.length} 個 H1：${h1s.slice(0, 4).map(h => '「' + truncUnits(h.text, 40) + '」').join('、')}`, fix: 'Google 表示多個 H1 不影響排名；但單一 H1 讓頁面主題與無障礙閱讀更清楚，建議主標題用 H1、其餘改為 H2。' });
    if (h1s.length) {
      const hU = units(h1s[0].text);
      add(cH, { id: 'h1-len', title: 'H1 長度', status: hU >= 6 && hU <= 80 ? 'pass' : 'warn', max: 3, detail: `寬度 ${hU}，建議 6–80。`, fix: hU < 6 ? 'H1 太短，請具體描述頁面主題。' : hU > 80 ? 'H1 過長，請精簡。' : '' });
      if (keyword) add(cH, { id: 'h1-kw', title: 'H1 包含目標關鍵字', status: kwIn(h1s[0].text) ? 'pass' : 'warn', max: 4, impact: 'high', detail: kwIn(h1s[0].text) ? '有包含。' : 'H1 未出現目標關鍵字。', fix: '在 H1 自然加入目標關鍵字。' });
      if (title && h1s[0].text === title) add(cH, { id: 'h1-title', title: 'H1 與 Title 完全相同', status: 'info', detail: '可接受，但讓 H1 與 Title 略有差異可涵蓋更多關鍵字變化。' });
    }
    add(cH, { id: 'h2', title: 'H2 子標題', status: h2s.length >= 2 ? 'pass' : h2s.length === 1 ? 'warn' : 'fail', max: 5, impact: 'medium', detail: `共 ${h2s.length} 個 H2，全頁共 ${headings.length} 個標題。`, fix: h2s.length >= 2 ? '' : '用 H2 將內容拆成清楚的段落主題，有助搜尋引擎與 AI 理解內容結構。' });
    add(cH, { id: 'h-skip', title: '標題階層連續', status: skips.length ? 'warn' : 'pass', max: 4, impact: 'low', detail: skips.length ? `跳級 ${skips.length} 處：${skips.slice(0, 3).join('；')}` : '沒有跳級（如 H2 直接到 H4）。', fix: skips.length ? '依序使用 H2 → H3 → H4，不要為了字體大小而跳級，樣式交給 CSS。' : '' });
    add(cH, { id: 'h-empty', title: '空白標題', status: emptyHeadings.length ? 'warn' : 'pass', max: 2, impact: 'low', detail: emptyHeadings.length ? `${emptyHeadings.length} 個標題沒有文字（可能只有圖片或圖示）。` : '沒有空白標題。', fix: emptyHeadings.length ? '為標題加入文字，若是圖片請加上 alt。' : '' });
    if (keyword) {
      const kwInSub = headings.filter(h => h.level >= 2 && kwIn(h.text)).length;
      add(cH, { id: 'h-kw', title: '子標題涵蓋關鍵字', status: kwInSub ? 'pass' : 'warn', max: 3, detail: `${kwInSub} 個 H2–H6 含有目標關鍵字。`, fix: '在 1–2 個 H2 中使用關鍵字或其同義詞。' });
    }

    /* ---- 3. Schema ---- */
    const cS = cat('schema', '結構化資料 Schema', '🧩', 11, 'both', 'JSON-LD / Schema.org');
    if (!ldBlocks.length) {
      add(cS, { id: 'ld', title: 'JSON-LD 結構化資料', status: 'warn', max: 10, impact: 'medium', detail: microdata.length ? `沒有 JSON-LD，但有 Microdata：${[...new Set(microdata)].join('、')}` : '頁面沒有任何 JSON-LD 結構化資料。', fix: 'Google 表示 AI 搜尋不需要結構化資料，但它仍是取得複合式搜尋結果、讓搜尋引擎理解頁面的方式。建議加入 JSON-LD（Google 建議格式）。至少包含 Organization + WebSite，並依頁面類型加入 Article / Product / LocalBusiness / FAQPage / BreadcrumbList。可到「程式碼產生器」分頁直接複製。' });
    } else {
      add(cS, { id: 'ld', title: 'JSON-LD 結構化資料', status: 'pass', max: 10, detail: `${ldBlocks.length} 段 JSON-LD，類型：${schemaTypes.join('、') || '（無 @type）'}` });
      add(cS, { id: 'ld-valid', title: 'JSON 語法正確', status: schemaErrors.length ? 'fail' : 'pass', max: 5, impact: 'high', detail: schemaErrors.length ? schemaErrors.join('；') : '所有 JSON-LD 均可正確解析。', fix: schemaErrors.length ? '修正 JSON 語法錯誤（常見：多餘逗號、未跳脫的雙引號、註解）。可用 validator.schema.org 驗證。' : '' });
      add(cS, { id: 'ld-ctx', title: '@context 指向 schema.org', status: ctxOk ? 'pass' : 'warn', max: 2, detail: ctxOk ? '正確。' : '部分區塊缺少 "@context": "https://schema.org"。', fix: ctxOk ? '' : '每段 JSON-LD 頂層加上 "@context": "https://schema.org"。' });
    }
    const hasOrg = schemaItems.some(o => hasType(o, ['Organization', 'Corporation', 'NewsMediaOrganization', ...LOCAL_TYPES]));
    add(cS, { id: 'org', title: 'Organization / LocalBusiness', status: hasOrg ? 'pass' : 'warn', max: 5, impact: 'high', detail: hasOrg ? '已宣告組織實體。' : '未宣告組織或商家實體。', fix: hasOrg ? '' : '加入 Organization（或 LocalBusiness）Schema，包含 name、url、logo、sameAs（社群/維基連結），建立品牌實體識別，對 AI 引用特別重要。' });
    const hasSite = schemaItems.some(o => hasType(o, ['WebSite']));
    add(cS, { id: 'website', title: 'WebSite Schema', status: hasSite ? 'pass' : 'warn', max: 3, impact: 'low', detail: hasSite ? '已宣告 WebSite。' : '未宣告 WebSite。', fix: hasSite ? '' : '加入 WebSite Schema（name、url），可協助 Google 顯示網站名稱。' });
    const hasBc = schemaItems.some(o => hasType(o, ['BreadcrumbList']));
    const isHome = urlObj ? (urlObj.pathname === '/' || urlObj.pathname === '') : false;
    add(cS, { id: 'breadcrumb', title: 'BreadcrumbList 麵包屑', status: hasBc ? 'pass' : isHome ? 'info' : 'warn', max: 3, impact: 'low', detail: hasBc ? '已宣告麵包屑。' : isHome ? '首頁可不需要麵包屑。' : '內頁未宣告麵包屑。', fix: hasBc ? '' : '內頁加入 BreadcrumbList。Google 自 2025 年起只在「桌機版」搜尋結果顯示麵包屑路徑。' });
    // 欄位驗證
    const fieldIssues = [];
    schemaItems.forEach(o => {
      typesOf(o).forEach(t => {
        const rule = SCHEMA_REQ[t] || (LOCAL_TYPES.includes(t) ? SCHEMA_REQ.LocalBusiness : null);
        if (!rule) return;
        const missReq = rule.req.filter(k => o[k] == null || o[k] === '');
        const missRec = rule.rec.filter(k => o[k] == null || o[k] === '');
        if (missReq.length) fieldIssues.push({ t, lvl: 'req', keys: missReq });
        if (missRec.length) fieldIssues.push({ t, lvl: 'rec', keys: missRec });
      });
    });
    if (schemaItems.length) {
      const req = fieldIssues.filter(f => f.lvl === 'req'), rec = fieldIssues.filter(f => f.lvl === 'rec');
      add(cS, {
        id: 'ld-fields', title: 'Schema 必要/建議欄位', status: req.length ? 'fail' : rec.length ? 'warn' : 'pass', max: 6, impact: req.length ? 'high' : 'medium',
        detail: req.length || rec.length ? [...req.map(f => `${f.t} 缺必要：${f.keys.join(', ')}`), ...rec.map(f => `${f.t} 建議補：${f.keys.join(', ')}`)].slice(0, 6).join('；') : '常見類型的必要與建議欄位皆完整。',
        fix: req.length ? '補齊必要欄位，否則無法取得複合式搜尋結果（Rich Results）。' : rec.length ? '補上建議欄位可增加複合式結果的豐富度與 AI 理解。' : ''
      });
    }

    /* ---- 4. FAQPage ---- */
    const cF = cat('faq', 'FAQ 問答內容', '❓', 4, 'geo', '問答內容與 FAQPage 標記');
    if (faqSchemas.length) {
      const n = schemaFaqs.length;
      add(cF, { id: 'faq-schema', title: 'FAQPage Schema', status: 'pass', max: 3, detail: `已宣告 FAQPage，共 ${n} 題有效問答。Google 已於 2026-05-07 停止顯示 FAQ 複合式結果，但標記仍是有效的 Schema.org 詞彙，可以保留。` });
      add(cF, { id: 'faq-valid', title: 'FAQ 結構完整', status: faqIssues.length ? 'fail' : 'pass', max: 6, impact: 'high', detail: faqIssues.length ? faqIssues.slice(0, 5).join('；') : '每題都有 Question.name 與 acceptedAnswer.text。', fix: faqIssues.length ? '每個 Question 需有 name，並有 acceptedAnswer（@type: Answer）含 text。' : '' });
      add(cF, { id: 'faq-count', title: '問答數量', status: n >= 3 ? 'pass' : 'warn', max: 3, impact: 'low', detail: `${n} 題，建議 3–10 題。`, fix: n >= 3 ? '' : '增加到至少 3 題真實使用者會問的問題。' });
      add(cF, { id: 'faq-visible', title: 'FAQ 內容在頁面上可見', status: faqVisible.length >= n * 0.8 ? 'pass' : 'warn', max: 4, impact: 'medium', detail: `${faqVisible.length}/${n} 題的問題文字可在頁面本文中找到。`, fix: faqVisible.length >= n * 0.8 ? '' : 'Google 規範：結構化資料內容必須與頁面可見內容一致，請將問答實際顯示在頁面上。' });
      const shortA = schemaFaqs.filter(f => wordCount(f.a) < 20).length;
      add(cF, { id: 'faq-depth', title: '答案完整度', status: shortA ? 'warn' : 'pass', max: 3, impact: 'medium', detail: shortA ? `${shortA} 題答案少於 20 字。` : '答案長度充足。', fix: shortA ? '答案太短可能無法真正解決問題；建議第一句直接回答，再補充必要說明。' : '' });
    } else {
      const visQ = detectedFaqs.length;
      add(cF, { id: 'faq-schema', title: 'FAQPage Schema（選用）', status: 'info', detail: (visQ ? `頁面上有 ${visQ} 組問答，但沒有 FAQPage 標記。` : '沒有 FAQPage 標記。') + 'Google 已於 2026-05-07 全面停止顯示 FAQ 複合式結果，且表示 AI 搜尋不需要特殊標記，因此不扣分。想加的話可用「程式碼產生器」。' });
      add(cF, { id: 'faq-content', title: '頁面問答內容', status: visQ >= 3 ? 'pass' : visQ ? 'warn' : 'fail', max: 5, impact: 'medium', detail: visQ ? `偵測到 ${visQ} 組：${detectedFaqs.slice(0, 3).map(f => '「' + truncUnits(f.q, 36) + '」').join('、')}` : '無。', fix: visQ >= 3 ? '' : '整理讀者真正會問的問題並在頁面上回答（例如常見問題區塊）。這是幫助讀者的內容，不是為了搜尋特效。' });
    }
    add(cF, { id: 'faq-note', title: 'FAQ 複合式結果現況', status: 'info', detail: 'Google 於 2023 年先限縮 FAQ 複合式結果，2026-05-07 起全面停止顯示（含政府與醫療網站），2026-06 移除相關文件。FAQPage 標記仍有效、不會報錯；頁面上的問答內容本身對讀者仍有價值。' });

    /* ---- 5. Content ---- */
    const cC = cat('content', '內容品質', '📝', 10, 'both', '字數、可讀性與關鍵字');
    add(cC, { id: 'words', title: '內容量', status: words >= 300 ? 'pass' : words >= 120 ? 'warn' : 'fail', max: 5, impact: words < 120 ? 'high' : 'medium', detail: `約 ${words.toLocaleString()} 字（中文以字計、英文以詞計）。Google 表示沒有「理想頁面長度」，此項只檢查內容是否過少。`, fix: words >= 300 ? '' : '內容可能不足以回答讀者的問題。重點是完整、有獨特觀點（例如第一手經驗），不是湊字數。' });
    add(cC, { id: 'ratio', title: '文字 / HTML 比例', status: 'info', detail: `${textRatio.toFixed(1)}%（HTML ${(htmlSize / 1024).toFixed(1)} KB）。Google 表示這不是排名因素，僅供參考。` });
    add(cC, { id: 'paras', title: '段落結構', status: paragraphs.length >= 5 ? 'pass' : paragraphs.length >= 2 ? 'warn' : 'fail', max: 3, impact: 'low', detail: `${paragraphs.length} 個 <p> 段落。`, fix: paragraphs.length >= 5 ? '' : '使用 <p> 分段，每段 2–4 句，提升閱讀與擷取性。' });
    const longParas = paragraphs.filter(p => wordCount(p) > 250).length;
    add(cC, { id: 'long-para', title: '段落長度適中', status: longParas ? 'warn' : 'pass', max: 2, impact: 'low', detail: longParas ? `${longParas} 段超過 250 字。` : '沒有過長段落。', fix: longParas ? '拆分長段落，一段只講一個重點。' : '' });
    add(cC, { id: 'lists', title: '清單與表格', status: lists.length + tables.length >= 2 ? 'pass' : lists.length + tables.length === 1 ? 'warn' : 'fail', max: 3, impact: 'medium', detail: `內容區 ${lists.length} 個清單、${tables.length} 個表格。`, fix: lists.length + tables.length >= 2 ? '' : '以條列步驟、比較表呈現資訊，搜尋引擎精選摘要與 AI 都偏好結構化格式。' });
    if (keyword) {
      const occ = countOccur(bodyText, keyword);
      const density = words ? (occ * wordCount(keyword)) / words * 100 : 0;
      add(cC, { id: 'kw-density', title: '關鍵字使用', status: occ === 0 ? 'fail' : density > 5 ? 'warn' : 'pass', max: 4, impact: occ === 0 ? 'high' : 'medium', detail: `「${keyword}」出現 ${occ} 次，約 ${density.toFixed(2)}%。Google 沒有「理想密度」，重點是自然涵蓋主題。`, fix: occ === 0 ? '內文完全沒有出現目標關鍵字，請在內容中自然說明這個主題。' : density > 5 ? '重複次數過多，可能違反 Google 垃圾內容政策中的「關鍵字堆砌」，改用同義詞與相關詞。' : '' });
      const first = contentText.slice(0, 300);
      add(cC, { id: 'kw-first', title: '開頭 100 字內出現關鍵字', status: kwIn(first) ? 'pass' : 'warn', max: 2, detail: kwIn(first) ? '有。' : '沒有。', fix: '在第一段就點出主題關鍵字。' });
    }
    const sentences = contentText.split(/[。！？!?]|\.\s/).map(clean).filter(s => s.length > 3);
    const avgSent = sentences.length ? sentences.reduce((n, s) => n + wordCount(s), 0) / sentences.length : 0;
    add(cC, { id: 'readability', title: '句子可讀性', status: avgSent <= 35 ? 'pass' : avgSent <= 55 ? 'warn' : 'fail', max: 3, impact: 'low', detail: `平均每句約 ${avgSent.toFixed(0)} 字。`, fix: avgSent <= 35 ? '' : '句子偏長，適度斷句，一句一個概念。' });

    /* ---- 6. Images ---- */
    const cI = cat('images', '圖片優化', '🖼️', 7, 'seo', 'ALT、尺寸、格式、延遲載入');
    if (!imgs.length) add(cI, { id: 'img-none', title: '頁面圖片', status: 'warn', max: 4, impact: 'low', detail: '頁面沒有 <img> 圖片。', fix: '適度加入具描述性 alt 的原創圖片，可增加圖片搜尋流量並提升內容豐富度。' });
    else {
      const altRate = (imgs.length - imgNoAlt.length) / imgs.length;
      add(cI, { id: 'alt', title: 'ALT 替代文字', status: imgNoAlt.length === 0 ? 'pass' : altRate >= 0.8 ? 'warn' : 'fail', max: 8, impact: 'high', detail: `${imgs.length} 張圖片，${imgNoAlt.length} 張缺少 alt${imgEmptyAlt.length ? `、${imgEmptyAlt.length} 張 alt 為空（裝飾圖可接受）` : ''}。${imgNoAlt.length ? '例：' + imgNoAlt.slice(0, 3).map(i => imgSrc(i).split('/').pop().slice(0, 40)).join('、') : ''}`, fix: imgNoAlt.length ? '為每張內容圖片加上描述性 alt（說明圖片內容，可自然帶入關鍵字）；純裝飾圖用 alt=""。' : '' });
      add(cI, { id: 'dim', title: '寬高屬性（防 CLS）', status: imgNoDim.length === 0 ? 'pass' : imgNoDim.length / imgs.length <= 0.3 ? 'warn' : 'fail', max: 4, impact: 'medium', detail: `${imgNoDim.length}/${imgs.length} 張未設定 width/height。`, fix: imgNoDim.length ? '加上 width 與 height 屬性，預留版面空間，降低版面位移（CLS）。' : '' });
      const lazyNeed = imgs.length > 3;
      add(cI, { id: 'lazy', title: '延遲載入 loading="lazy"', status: !lazyNeed || imgLazy.length ? 'pass' : 'warn', max: 3, impact: 'low', detail: `${imgLazy.length}/${imgs.length} 張使用延遲載入。`, fix: !lazyNeed || imgLazy.length ? '' : '首屏以下的圖片加上 loading="lazy"；首屏主圖則不要 lazy。' });
      add(cI, { id: 'format', title: '新一代圖片格式', status: imgModern.length / imgs.length >= 0.5 ? 'pass' : imgModern.length ? 'warn' : 'warn', max: 3, impact: 'low', detail: `${imgModern.length}/${imgs.length} 張使用 WebP/AVIF。`, fix: imgModern.length / imgs.length >= 0.5 ? '' : '將 JPG/PNG 轉為 WebP 或 AVIF，可減少 25–50% 檔案大小。' });
    }

    /* ---- 7. Links ---- */
    const cL = cat('links', '連結結構', '🔗', 6, 'seo', '內外部連結與錨點文字');
    add(cL, { id: 'internal', title: '內部連結', status: internalLinks.length >= 5 ? 'pass' : internalLinks.length >= 1 ? 'warn' : 'fail', max: 5, impact: 'medium', detail: `${internalLinks.length} 個內部連結（${new Set(internalLinks.map(l => l.abs)).size} 個不重複）。`, fix: internalLinks.length >= 5 ? '' : '增加指向相關頁面的內部連結，協助爬蟲探索並傳遞權重。' });
    add(cL, { id: 'external', title: '外部連結', status: externalLinks.length ? 'pass' : 'warn', max: 3, impact: 'low', detail: `${externalLinks.length} 個外部連結，其中 ${nofollow.length} 個 nofollow/sponsored/ugc。`, fix: externalLinks.length ? '' : '適度引用權威外部來源，可提升內容可信度（E-E-A-T）。' });
    add(cL, { id: 'anchor', title: '錨點文字品質', status: emptyAnchor.length + genericAnchor.length === 0 ? 'pass' : (emptyAnchor.length + genericAnchor.length) <= 3 ? 'warn' : 'fail', max: 4, impact: 'medium', detail: `${emptyAnchor.length} 個無文字連結、${genericAnchor.length} 個泛用文字（如「點此」「更多」）。`, fix: emptyAnchor.length + genericAnchor.length ? '使用描述目的地的錨點文字；圖示連結請加 aria-label。' : '' });
    const jsLinks = links.filter(l => l.js);
    if (jsLinks.length) add(cL, { id: 'jslink', title: 'javascript: 連結', status: 'warn', max: 2, impact: 'low', detail: `${jsLinks.length} 個 href="javascript:…" 連結，爬蟲無法跟隨。`, fix: '改用真實網址或 <button>。' });

    /* ---- 8. Technical ---- */
    const cX = cat('technical', '技術 SEO', '⚙️', 13, 'seo', '索引、Canonical、行動版與基礎設定');
    const https = urlObj ? urlObj.protocol === 'https:' : null;
    if (https !== null) add(cX, { id: 'https', title: 'HTTPS 加密', status: https ? 'pass' : 'fail', max: 6, impact: 'high', detail: https ? '使用 HTTPS。' : '未使用 HTTPS。', fix: https ? '' : '安裝 SSL 憑證並將 HTTP 301 轉址至 HTTPS（GitHub Pages / Cloudflare 皆可免費啟用）。' });
    const noindex = /noindex|none/.test(robotsMeta);
    add(cX, { id: 'noindex', title: '可被索引（meta robots）', status: noindex ? 'fail' : 'pass', max: 8, impact: 'high', detail: noindex ? `meta robots 含 noindex：「${robotsMeta.replace(/^,|,$/g, '')}」` : (robotsMeta.replace(/,/g, '') ? `meta robots：${robotsMeta.replace(/^,|,$/g, '')}` : '未設定 noindex（預設可索引）。'), fix: noindex ? '若希望此頁出現在搜尋結果，移除 noindex。' : '' });
    if (!canonical) add(cX, { id: 'canonical', title: 'Canonical 標準網址', status: 'warn', max: 5, impact: 'medium', detail: '未設定 rel="canonical"。', fix: '加入 <link rel="canonical" href="完整網址">，避免參數或大小寫造成重複內容。' });
    else {
      const cAbs = absUrl(canonical, base || 'https://example.invalid/');
      const isAbs = /^https?:\/\//i.test(canonical);
      let self = true;
      if (url && cAbs) { try { const a = new URL(cAbs), b = new URL(url); self = a.hostname === b.hostname && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, ''); } catch (e) { } }
      add(cX, { id: 'canonical', title: 'Canonical 標準網址', status: isAbs && self ? 'pass' : 'warn', max: 5, impact: 'medium', detail: `${canonical}${!isAbs ? '（相對路徑）' : ''}${!self ? '（指向其他網址）' : ''}`, fix: !isAbs ? 'Canonical 建議使用完整絕對網址。' : !self ? '確認此頁是否刻意指向其他頁面；若否，請改為自身網址。' : '' });
    }
    add(cX, { id: 'viewport', title: '行動裝置 Viewport', status: viewport ? (/width=device-width/.test(viewport) ? 'pass' : 'warn') : 'fail', max: 6, impact: 'high', detail: viewport ? viewport : '未設定 viewport。', fix: viewport && /width=device-width/.test(viewport) ? '' : '加入 <meta name="viewport" content="width=device-width, initial-scale=1">。' });
    add(cX, { id: 'lang', title: 'HTML lang 語言宣告', status: lang ? 'pass' : 'warn', max: 3, impact: 'medium', detail: lang ? `lang="${lang}"` : '<html> 未設定 lang。', fix: lang ? '' : '繁體中文網站建議 <html lang="zh-Hant-TW">（或 zh-TW）。' });
    add(cX, { id: 'charset', title: '字元編碼', status: charset ? 'pass' : 'warn', max: 2, impact: 'low', detail: charset ? '已宣告。' : '未宣告 charset。', fix: charset ? '' : '在 <head> 第一行加入 <meta charset="utf-8">。' });
    if (!ctx.rendered) add(cX, { id: 'doctype', title: 'DOCTYPE', status: /^\s*(<!--[\s\S]*?-->\s*)*<!doctype html/i.test(html) ? 'pass' : 'warn', max: 1, impact: 'low', detail: /^\s*(<!--[\s\S]*?-->\s*)*<!doctype html/i.test(html) ? '<!DOCTYPE html>' : '缺少 HTML5 DOCTYPE。', fix: '檔案第一行加上 <!DOCTYPE html>。' });
    add(cX, { id: 'favicon', title: 'Favicon', status: favicon ? 'pass' : 'warn', max: 2, impact: 'low', detail: favicon ? favicon.getAttribute('href') : '未宣告 favicon。', fix: favicon ? '' : 'Google 搜尋結果會顯示 favicon，請加入 <link rel="icon" href="images/favicon.png">。' });
    if (hreflangs.length) {
      const hasXD = hreflangs.some(h => h.lang.toLowerCase() === 'x-default');
      add(cX, { id: 'hreflang', title: 'hreflang 多語系', status: hasXD ? 'pass' : 'warn', max: 2, impact: 'low', detail: `${hreflangs.length} 組：${hreflangs.map(h => h.lang).join(', ')}`, fix: hasXD ? '' : '加入 hreflang="x-default" 作為預設語系。' });
    }
    if (urlObj) {
      const p = urlObj.pathname + urlObj.search;
      const issues = [];
      if (p.length > 100) issues.push('網址過長');
      if (/_/.test(urlObj.pathname)) issues.push('使用底線（建議用連字號 -）');
      if (/[A-Z]/.test(urlObj.pathname)) issues.push('含大寫字母');
      if ((urlObj.search.match(/&/g) || []).length >= 2) issues.push('參數過多');
      add(cX, { id: 'url', title: '網址結構', status: issues.length ? 'warn' : 'pass', max: 2, impact: 'low', detail: issues.length ? issues.join('、') : '簡潔易讀。', fix: issues.length ? '使用小寫、以連字號分隔、具語意的短網址。' : '' });
    }
    const robotsAux = ctx.robots;
    if (robotsAux && robotsAux.state === 'ok') {
      const r = parseRobots(robotsAux.text);
      const path = urlObj ? urlObj.pathname : '/';
      const gb = robotsBlocked(r, 'Googlebot', path);
      add(cX, { id: 'robots', title: 'robots.txt', status: gb.blocked ? 'fail' : 'pass', max: 4, impact: 'high', detail: gb.blocked ? `Googlebot 被 robots.txt 封鎖（規則：Disallow: ${gb.rule.path}）。` : `存在，Googlebot 可抓取此頁。${r.sitemaps.length ? '已宣告 Sitemap。' : ''}`, fix: gb.blocked ? '調整 robots.txt 規則，允許搜尋引擎抓取重要頁面。' : '' });
      if (!r.sitemaps.length) add(cX, { id: 'robots-sm', title: 'robots.txt 宣告 Sitemap', status: 'warn', max: 2, impact: 'low', detail: 'robots.txt 中沒有 Sitemap: 行。', fix: '在 robots.txt 加入：Sitemap: https://你的網域/sitemap.xml' });
    } else if (robotsAux && robotsAux.state === 'missing') {
      add(cX, { id: 'robots', title: 'robots.txt', status: 'warn', max: 4, impact: 'medium', detail: '找不到 robots.txt。', fix: '在網站根目錄建立 robots.txt（可到「程式碼產生器」取得範本）。' });
    } else add(cX, { id: 'robots', title: 'robots.txt', status: 'info', detail: '無法取得（貼上原始碼模式或網路限制），未計分。' });
    const sm = ctx.sitemap;
    if (sm && sm.state === 'ok') {
      const n = (sm.text.match(/<loc>/gi) || []).length;
      add(cX, { id: 'sitemap', title: 'XML Sitemap', status: 'pass', max: 4, detail: `${sm.url} 可存取，含 ${n} 個 <loc>。` });
    } else if (sm && sm.state === 'missing') add(cX, { id: 'sitemap', title: 'XML Sitemap', status: 'warn', max: 4, impact: 'medium', detail: `找不到 ${sm.url}。`, fix: '建立 sitemap.xml 並提交至 Google Search Console 與 Bing Webmaster Tools。' });
    else add(cX, { id: 'sitemap', title: 'XML Sitemap', status: 'info', detail: '無法取得，未計分。' });
    const deprecated = $$('font,center,marquee,blink,frameset');
    if (deprecated.length) add(cX, { id: 'deprecated', title: '過時 HTML 標籤', status: 'warn', max: 1, impact: 'low', detail: `發現 ${deprecated.length} 個（${[...new Set(deprecated.map(e => e.tagName.toLowerCase()))].join(', ')}）。`, fix: '改用語意化 HTML5 與 CSS。' });
    const semantic = ['main', 'header', 'nav', 'footer', 'article', 'section'].filter(t => doc.querySelector(t));
    add(cX, { id: 'semantic', title: 'HTML5 語意標籤', status: semantic.length >= 4 ? 'pass' : semantic.length >= 2 ? 'warn' : 'fail', max: 3, impact: 'low', detail: `使用：${semantic.join(', ') || '無'}`, fix: semantic.length >= 4 ? '' : '使用 <header> <nav> <main> <article> <section> <footer> 讓爬蟲與 AI 辨識主要內容區域。' });

    /* ---- 9. Social ---- */
    const cO = cat('social', '社群分享 OG', '📣', 5, 'seo', 'Open Graph / Twitter Card');
    const ogReq = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'];
    const ogMiss = ogReq.filter(k => !og[k]);
    add(cO, { id: 'og', title: 'Open Graph 標籤', status: ogMiss.length === 0 ? 'pass' : ogMiss.length <= 2 ? 'warn' : 'fail', max: 6, impact: 'medium', detail: ogMiss.length ? `缺少：${ogMiss.join(', ')}` : '五個核心 OG 標籤齊全。', fix: ogMiss.length ? '補齊 OG 標籤，分享到 Facebook / LINE / Threads 時才會顯示正確標題與縮圖。' : '' });
    if (og['og:image']) {
      const oi = og['og:image'];
      add(cO, { id: 'og-img', title: 'OG 圖片網址', status: /^https?:\/\//i.test(oi) ? 'pass' : 'warn', max: 2, impact: 'low', detail: oi, fix: /^https?:\/\//i.test(oi) ? '' : 'og:image 必須是完整絕對網址（https://…），建議尺寸 1200×630。' });
    }
    add(cO, { id: 'twitter', title: 'Twitter / X Card', status: tw['twitter:card'] ? 'pass' : 'warn', max: 2, impact: 'low', detail: tw['twitter:card'] ? `twitter:card = ${tw['twitter:card']}` : '未設定 twitter:card。', fix: tw['twitter:card'] ? '' : '加入 <meta name="twitter:card" content="summary_large_image">。' });
    add(cO, { id: 'site-name', title: 'og:site_name 品牌名稱', status: og['og:site_name'] ? 'pass' : 'warn', max: 1, impact: 'low', detail: og['og:site_name'] || '未設定。', fix: og['og:site_name'] ? '' : '加入 og:site_name 強化品牌識別。' });

    /* ---- 10. GEO ---- */
    const cG = cat('geo', 'GEO / AI 搜尋可見度', '🤖', 16, 'geo', 'AI Overviews、AI Mode、ChatGPT、Perplexity、Copilot');
    // AI 爬蟲
    let botResults = null;
    if (robotsAux && robotsAux.state === 'ok') {
      const r = parseRobots(robotsAux.text);
      const path = urlObj ? urlObj.pathname : '/';
      botResults = AI_BOTS.map(b => Object.assign({}, b, robotsBlocked(r, b.ua, path)));
      const blockedSearch = botResults.filter(b => b.blocked && b.kind === 'search');
      const blockedUser = botResults.filter(b => b.blocked && b.kind === 'user');
      const blockedTrain = botResults.filter(b => b.blocked && b.kind === 'train');
      add(cG, { id: 'ai-bots', title: 'AI 搜尋爬蟲存取', status: blockedSearch.length === 0 ? 'pass' : blockedSearch.length <= 2 ? 'warn' : 'fail', max: 10, impact: 'high', detail: blockedSearch.length ? `封鎖了 AI 搜尋爬蟲：${blockedSearch.map(b => b.ua).join('、')}` : 'AI 搜尋類爬蟲（OAI-SearchBot、PerplexityBot、Claude-SearchBot 等）皆可存取。', fix: blockedSearch.length ? '解除對搜尋類爬蟲的封鎖，否則對應的搜尋或 AI 服務無法收錄、引用你的內容（Googlebot 同時影響 Google 搜尋與 AI Overviews）。' : '' });
      add(cG, { id: 'ai-train', title: 'AI 訓練與使用者觸發爬蟲', status: 'info', detail: (blockedTrain.length ? `封鎖訓練用爬蟲：${blockedTrain.map(b => b.ua).join('、')}（屬商業決策；Google-Extended 官方說明不影響 Google 搜尋）。` : '未封鎖訓練用爬蟲（GPTBot、ClaudeBot、Google-Extended 等）。') + (blockedUser.length ? ` 另封鎖了使用者觸發的爬蟲：${blockedUser.map(b => b.ua).join('、')}；注意官方說明 ChatGPT-User、Perplexity-User 不一定遵守 robots.txt。` : '') });
    } else if (robotsAux && robotsAux.state === 'missing') {
      botResults = AI_BOTS.map(b => Object.assign({}, b, { blocked: false, specific: false }));
      add(cG, { id: 'ai-bots', title: 'AI 搜尋爬蟲存取', status: 'pass', max: 10, detail: '沒有 robots.txt，所有爬蟲預設可存取。' });
    } else add(cG, { id: 'ai-bots', title: 'AI 搜尋爬蟲存取', status: 'info', detail: '無法取得 robots.txt，未計分。' });
    if (/nosnippet|max-snippet:\s*0/.test(robotsMeta)) add(cG, { id: 'nosnippet', title: '摘要限制 nosnippet', status: 'fail', max: 8, impact: 'high', detail: 'meta robots 含 nosnippet 或 max-snippet:0，Google AI Overviews 與精選摘要將無法引用此頁。', fix: '移除 nosnippet，或改為 max-snippet:-1。' });
    // llms.txt
    const lt = ctx.llms;
    if (lt && lt.state === 'ok') {
      const ok = /^#\s+\S/m.test(lt.text);
      add(cG, { id: 'llms', title: 'llms.txt（選用）', status: 'info', detail: (ok ? `存在（${lt.text.length.toLocaleString()} 字元）。` : '存在但格式不符 llmstxt.org 建議（# 標題、> 摘要、## 連結清單）。') + '此為提案中的格式，Google 表示不使用，主要 AI 搜尋引擎也未正式支援，因此不計分。' });
    } else if (lt && lt.state === 'missing') add(cG, { id: 'llms', title: 'llms.txt（選用）', status: 'info', detail: '沒有 /llms.txt。這是提案中的格式，Google 表示不使用，主要 AI 搜尋引擎也未正式支援，因此不計分；想嘗試可用「程式碼產生器」的範本。' });
    else add(cG, { id: 'llms', title: 'llms.txt', status: 'info', detail: '無法取得，未計分。' });
    // SSR
    if (ctx.rendered) add(cG, { id: 'ssr', title: '伺服器端可讀內容（非純 JS 渲染）', status: 'info', detail: '本次讀取的是瀏覽器渲染後的 DOM，無法判斷原始 HTML 是否含內容。請用「貼上原始碼」（Ctrl+U 的內容）確認。' });
    else add(cG, { id: 'ssr', title: '伺服器端可讀內容（非純 JS 渲染）', status: isCsrShell ? 'fail' : words >= 150 ? 'pass' : 'warn', max: 8, impact: 'high', detail: isCsrShell ? '原始 HTML 幾乎沒有文字，內容疑似由 JavaScript 在瀏覽器端產生（SPA）。多數 AI 爬蟲不執行 JS，將看不到內容。' : `原始 HTML 含約 ${words.toLocaleString()} 字可讀內容。`, fix: isCsrShell ? '改用 SSR / SSG（如 Next.js、Nuxt、Astro）或預先渲染，確保 HTML 原始碼即含完整內容。' : words < 150 ? '增加 HTML 中直接可讀的文字內容。' : '' });
    // 問句式標題
    add(cG, { id: 'q-heading', title: '問題式標題', status: questionHeadings.length >= 2 ? 'pass' : 'warn', max: 2, impact: 'medium', detail: `${questionHeadings.length} 個 H2–H6 為問句。${questionHeadings.slice(0, 3).map(h => '「' + truncUnits(h.text, 30) + '」').join('')}`, fix: questionHeadings.length >= 2 ? '' : '（經驗值，非 Google 要求）適合的話，用讀者真正會問的問題當子標題，讓內容更直接回應需求。Google 表示不需要為 AI 改寫各種問法。' });
    // 直接答案段落
    add(cG, { id: 'citable', title: '重點先行的段落', status: citable.length >= 2 ? 'pass' : 'warn', max: 3, impact: 'low', detail: `${citable.length} 個標題下方緊接一段完整說明。`, fix: citable.length >= 2 ? '' : '（經驗值）每個段落開頭先講重點，讀者與各家 AI 摘要都更容易理解。Google 明確表示不需要為 AI 把內容「切塊」。' });
    // 統計數據
    const statN = statMatches.length;
    add(cG, { id: 'stats', title: '具體數據與統計', status: statN >= 3 ? 'pass' : 'warn', max: 3, impact: 'medium', detail: `偵測到 ${statN} 個量化數據${statN ? '，例：' + statMatches.slice(0, 4).join('、') : ''}。`, fix: statN >= 3 ? '' : 'GEO 學術研究（Aggarwal 等，KDD 2024）發現加入統計數據、引用來源能提高內容在生成式引擎中的能見度；請補充有出處的具體數據。' });
    // 權威引用
    add(cG, { id: 'cite-src', title: '引用權威來源', status: authorityLinks.length >= 1 ? 'pass' : 'warn', max: 3, impact: 'medium', detail: `${authorityLinks.length} 個權威外連（政府、學術、維基、研究），共 ${externalLinks.length} 個外連。`, fix: authorityLinks.length >= 1 ? '' : '為關鍵論點附上政府、學術或產業報告來源連結，增加可信度。' });
    // 作者
    add(cG, { id: 'author', title: '作者 / 發布者資訊（E-E-A-T）', status: hasAuthor ? 'pass' : 'warn', max: 5, impact: 'medium', detail: hasAuthor ? '偵測到作者資訊。' : '未偵測到作者或撰文者資訊。', fix: hasAuthor ? '' : '標示作者姓名、專業背景與作者頁連結，並在 Article Schema 加入 author（Person）。' });
    // 更新日期
    add(cG, { id: 'fresh', title: '內容時效性', status: latestDate ? (ageDays <= 730 ? 'pass' : 'warn') : 'warn', max: 3, impact: latestDate ? 'low' : 'medium', detail: latestDate ? `最新日期 ${latestDate.toISOString().slice(0, 10)}（約 ${ageDays} 天前）。` : '未偵測到發布/更新日期。', fix: latestDate && ageDays <= 730 ? '' : latestDate ? '內容超過兩年未更新；若主題具時效性（價格、法規、數據），請更新內容並同步 dateModified。長青內容可不必頻繁更新。' : '在頁面與 Article Schema 標示 datePublished / dateModified，讓搜尋引擎與 AI 判斷內容新舊。' });
    // 實體 sameAs
    add(cG, { id: 'entity', title: '品牌實體連結 sameAs', status: sameAs.length >= 1 ? 'pass' : 'warn', max: 3, impact: 'medium', detail: sameAs.length ? `${sameAs.length} 個：${sameAs.slice(0, 4).map(s => s.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]).join('、')}` : 'Organization/Person Schema 中沒有 sameAs。', fix: sameAs.length >= 1 ? '' : '在 Organization Schema 加入 sameAs，連到 Facebook、Instagram、LinkedIn、YouTube、維基百科、Google 商家等，協助 AI 確認品牌身分。' });
    // 定義句
    add(cG, { id: 'define', title: '清楚的定義句', status: definitionSentences.length >= 1 ? 'pass' : 'warn', max: 2, impact: 'low', detail: definitionSentences.length ? `例：「${truncUnits(clean(definitionSentences[0]), 80)}」` : '沒有偵測到「X 是指…」「X 是一種…」形式的定義句。', fix: definitionSentences.length ? '' : '在開頭用一句話定義核心主題（例：「GEO 是指針對生成式 AI 搜尋引擎的內容優化」），讓讀者一開始就知道主題（經驗值）。' });
    // 結構化內容
    add(cG, { id: 'struct', title: '結構化呈現（清單/表格/FAQ）', status: (lists.length + tables.length + (detectedFaqs.length ? 1 : 0)) >= 2 ? 'pass' : 'warn', max: 3, impact: 'medium', detail: `清單 ${lists.length}、表格 ${tables.length}、問答 ${detectedFaqs.length}。`, fix: '步驟用編號清單、比較用表格、疑問用 FAQ，讓讀者更快找到資訊。' });

    add(cG, { id: 'gsc-ai', title: 'Search Console 生成式 AI 設定（請自行確認）', status: 'info', detail: 'Google 2026 官方指南：網站必須可被索引、可顯示摘要，並在 Search Console 的「Search 生成式 AI 功能」設定中被納入，才有資格出現在 AI Overviews / AI Mode；可用「生成式 AI 成效報告」追蹤表現。Bing Webmaster Tools 也有「AI Performance」報告可看 Copilot 引用次數。此項無法從外部檢測。' });

    /* ---- 11. Performance ---- */
    const cP = cat('perf', '效能指標（靜態）', '⚡', 5, 'seo', '依原始碼推估，非實測 Core Web Vitals');
    add(cP, { id: 'html-size', title: 'HTML 檔案大小', status: htmlSize < 100 * 1024 ? 'pass' : htmlSize < 300 * 1024 ? 'warn' : 'fail', max: 3, impact: 'low', detail: `${(htmlSize / 1024).toFixed(1)} KB`, fix: htmlSize < 100 * 1024 ? '' : '壓縮 HTML、移除大量內嵌資料與註解。' });
    add(cP, { id: 'blocking', title: '阻塞渲染的腳本', status: headScripts.length === 0 ? 'pass' : headScripts.length <= 2 ? 'warn' : 'fail', max: 4, impact: 'medium', detail: `<head> 中有 ${headScripts.length} 個未加 async/defer 的外部腳本。`, fix: headScripts.length ? '為非必要腳本加上 defer 或 async，或移到 </body> 前。' : '' });
    add(cP, { id: 'requests', title: '外部資源數量', status: scripts.length + stylesheets.length <= 15 ? 'pass' : scripts.length + stylesheets.length <= 30 ? 'warn' : 'fail', max: 3, impact: 'low', detail: `${scripts.length} 個 JS、${stylesheets.length} 個 CSS、${imgs.length} 張圖片、${iframes.length} 個 iframe。`, fix: scripts.length + stylesheets.length <= 15 ? '' : '合併或移除不必要的第三方腳本與樣式表。' });
    add(cP, { id: 'inline', title: '內嵌程式碼量', status: inlineScriptSize + inlineStyleSize < 50000 ? 'pass' : 'warn', max: 2, impact: 'low', detail: `內嵌 JS ${(inlineScriptSize / 1024).toFixed(1)} KB、內嵌 CSS ${(inlineStyleSize / 1024).toFixed(1)} KB。`, fix: inlineScriptSize + inlineStyleSize < 50000 ? '' : '將大型內嵌程式碼抽出為外部檔案以利快取。' });
    add(cP, { id: 'hints', title: '資源提示 preconnect/preload', status: preconnect.length ? 'pass' : 'info', max: 1, detail: preconnect.length ? `${preconnect.length} 個資源提示。` : '未使用（若有第三方字型或 CDN 可考慮加入）。' });
    if (ctx.fetchMs) add(cP, { id: 'ttfb', title: '回應時間（經代理，僅供參考）', status: 'info', detail: `約 ${ctx.fetchMs} ms（${ctx.via === 'direct' ? '直接連線' : '透過 CORS 代理，實際速度通常更快'}）。真實 Core Web Vitals 請以 PageSpeed Insights 為準。` });

    /* ---- 計算分數 ---- */
    cats.forEach(c => {
      const scored = c.checks.filter(k => k.max > 0);
      const max = scored.reduce((n, k) => n + k.max, 0);
      const got = scored.reduce((n, k) => n + k.score, 0);
      c.score = max ? Math.round(got / max * 100) : 100;
      c.counts = {
        pass: c.checks.filter(k => k.status === 'pass').length,
        warn: c.checks.filter(k => k.status === 'warn').length,
        fail: c.checks.filter(k => k.status === 'fail').length,
        info: c.checks.filter(k => k.status === 'info').length
      };
    });
    const weighted = (list, wfn) => {
      const tw = list.reduce((n, c) => n + wfn(c), 0);
      return tw ? Math.round(list.reduce((n, c) => n + c.score * wfn(c), 0) / tw) : 0;
    };
    const overall = weighted(cats, c => c.weight);
    const seoScore = weighted(cats.filter(c => c.group !== 'geo'), c => c.weight);
    const geoW = { geo: 60, faq: 10, schema: 15, content: 15 };
    const geoScore = weighted(cats.filter(c => geoW[c.id]), c => geoW[c.id]);

    /* ---- 資料彙整 ---- */
    const data = {
      url, title, desc, keywordsMeta, canonical, lang, robotsMeta: robotsMeta.replace(/^,|,$/g, ''), viewport,
      og, tw, hreflangs, headings: headings.map(h => ({ level: h.level, text: h.text, skip: !!h.skip })),
      words, htmlSize, textRatio, imgs: imgs.length, imgNoAlt: imgNoAlt.length,
      imgList: imgs.slice(0, 60).map(i => ({ src: imgSrc(i), alt: i.getAttribute('alt'), w: i.getAttribute('width'), h: i.getAttribute('height'), lazy: i.getAttribute('loading') })),
      internal: internalLinks.length, external: externalLinks.length,
      linkList: realLinks.slice(0, 200).map(l => ({ href: l.abs || l.href, text: l.text, internal: l.internal, rel: l.rel })),
      schemaTypes, ldRaw, schemaErrors, microdata: [...new Set(microdata)], rdfa: [...new Set(rdfa)],
      faqs: detectedFaqs, hasFaqSchema: faqSchemas.length > 0,
      keywords: topKeywords(contentText, 20), keyword,
      bots: botResults, latestDate: latestDate ? latestDate.toISOString().slice(0, 10) : null,
      favicon: favicon ? absUrl(favicon.getAttribute('href'), base || 'https://example.invalid/') : null,
      citable: citable.slice(0, 8), statSamples: statMatches.slice(0, 10), sameAs,
      internalSample: [...new Map(internalLinks.filter(l => l.text && l.abs).map(l => [l.abs.split('#')[0], l])).values()].slice(0, 15).map(l => ({ href: l.abs.split('#')[0], text: l.text })),
      siteName: og['og:site_name'] || (title.split(/\s[|｜\-–—]\s|[|｜]/).pop() || '').trim(),
      ogImage: og['og:image'] ? absUrl(og['og:image'], base || 'https://example.invalid/') : null,
      years: yearMatches.length
    };

    return { url, keyword, when: new Date().toISOString(), overall, seoScore, geoScore, categories: cats, data };
  }

  /* ==========================================================
     建議程式碼產生
     ========================================================== */
  function snippets(rep) {
    const d = rep.data;
    let origin = 'https://www.example.com', pageUrl = 'https://www.example.com/';
    try { const u = new URL(d.url); origin = u.origin; pageUrl = u.href.split('#')[0]; } catch (e) { }
    const siteName = d.siteName || '你的品牌名稱';
    const kw = d.keyword || (d.keywords[0] ? d.keywords[0][0] : '核心關鍵字');
    const sugTitle = d.title && units(d.title) <= 60 && units(d.title) >= 30 ? d.title : (d.title ? truncUnits(d.title, 56).replace(/…$/, '') : `${kw}｜一句話說明價值 - ${siteName}`);
    const sugDesc = d.desc && units(d.desc) >= 100 && units(d.desc) <= 165 ? d.desc : (d.desc ? truncUnits(d.desc, 156) : `用 60–80 個中文字說明這頁能為讀者解決什麼問題，包含「${kw}」與具體利益點，最後加上行動呼籲。`);
    const img = d.ogImage || origin + '/images/og-cover.png';

    const head = [
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${esc(sugTitle)}</title>`,
      `<meta name="description" content="${esc(sugDesc)}">`,
      `<link rel="canonical" href="${esc(pageUrl)}">`,
      `<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">`,
      '',
      '<!-- Open Graph -->',
      '<meta property="og:type" content="website">',
      `<meta property="og:site_name" content="${esc(siteName)}">`,
      `<meta property="og:title" content="${esc(sugTitle)}">`,
      `<meta property="og:description" content="${esc(sugDesc)}">`,
      `<meta property="og:url" content="${esc(pageUrl)}">`,
      `<meta property="og:image" content="${esc(img)}">`,
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      '<meta property="og:locale" content="zh_TW">',
      '',
      '<!-- Twitter / X -->',
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="twitter:title" content="${esc(sugTitle)}">`,
      `<meta name="twitter:description" content="${esc(sugDesc)}">`,
      `<meta name="twitter:image" content="${esc(img)}">`,
      '',
      '<link rel="icon" href="images/favicon.png" type="image/png">'
    ].join('\n');

    const sameAsEx = d.sameAs.length ? d.sameAs : ['https://www.facebook.com/你的粉專', 'https://www.instagram.com/你的帳號', 'https://www.linkedin.com/company/你的公司', 'https://www.youtube.com/@你的頻道'];
    const orgLd = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization', '@id': origin + '/#organization',
          name: siteName, url: origin + '/',
          logo: { '@type': 'ImageObject', url: origin + '/images/logo.png' },
          description: d.desc || '一句話描述你的品牌與服務。',
          sameAs: sameAsEx,
          contactPoint: { '@type': 'ContactPoint', telephone: '+886-2-1234-5678', contactType: 'customer service', areaServed: 'TW', availableLanguage: ['zh-Hant', 'en'] }
        },
        {
          '@type': 'WebSite', '@id': origin + '/#website',
          url: origin + '/', name: siteName, inLanguage: d.lang || 'zh-Hant-TW',
          publisher: { '@id': origin + '/#organization' }
        },
        {
          '@type': 'WebPage', '@id': pageUrl + '#webpage',
          url: pageUrl, name: d.title || sugTitle, description: d.desc || sugDesc,
          isPartOf: { '@id': origin + '/#website' },
          about: { '@id': origin + '/#organization' },
          inLanguage: d.lang || 'zh-Hant-TW',
          dateModified: new Date().toISOString().slice(0, 10)
        }
      ]
    };

    const segs = (() => { try { return new URL(d.url).pathname.split('/').filter(Boolean); } catch (e) { return ['分類', '文章']; } })();
    const bcItems = [{ '@type': 'ListItem', position: 1, name: '首頁', item: origin + '/' }];
    let acc = origin;
    segs.forEach((s, i) => {
      acc += '/' + s;
      bcItems.push({ '@type': 'ListItem', position: i + 2, name: i === segs.length - 1 && d.headings.find(h => h.level === 1) ? d.headings.find(h => h.level === 1).text : decodeURIComponent(s).replace(/[-_]/g, ' ').replace(/\.html?$/, ''), item: acc });
    });
    const bcLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: bcItems };

    const h1 = (d.headings.find(h => h.level === 1) || {}).text || sugTitle;
    const articleLd = {
      '@context': 'https://schema.org', '@type': 'Article',
      headline: truncUnits(h1, 110),
      description: d.desc || sugDesc,
      image: [img],
      author: { '@type': 'Person', name: '作者姓名', url: origin + '/about/作者', jobTitle: '專業職稱' },
      publisher: { '@id': origin + '/#organization' },
      datePublished: d.latestDate || new Date().toISOString().slice(0, 10),
      dateModified: new Date().toISOString().slice(0, 10),
      mainEntityOfPage: pageUrl,
      inLanguage: d.lang || 'zh-Hant-TW'
    };

    const robots = [
      '# robots.txt — 允許搜尋引擎與 AI 搜尋爬蟲',
      'User-agent: *',
      'Allow: /',
      '',
      '# AI 搜尋 / 即時瀏覽（建議允許，才能被 AI 引用）',
      'User-agent: OAI-SearchBot',
      'User-agent: ChatGPT-User',
      'User-agent: Claude-SearchBot',
      'User-agent: Claude-User',
      'User-agent: PerplexityBot',
      'User-agent: Perplexity-User',
      'Allow: /',
      '',
      '# AI 訓練爬蟲（依品牌政策決定 Allow 或 Disallow）',
      'User-agent: GPTBot',
      'User-agent: ClaudeBot',
      'User-agent: Google-Extended',
      'User-agent: Applebot-Extended',
      'Allow: /',
      '',
      `Sitemap: ${origin}/sitemap.xml`
    ].join('\n');

    const pages = d.internalSample.length ? d.internalSample : [{ href: origin + '/about', text: '關於我們' }, { href: origin + '/services', text: '服務項目' }, { href: origin + '/blog', text: '部落格' }];
    const llms = [
      `# ${siteName}`,
      '',
      `> ${d.desc || '用 1–2 句話說明網站是誰、提供什麼、服務對象。'}`,
      '',
      '本網站的重點資訊：',
      `- 主要主題：${d.keywords.slice(0, 5).map(k => k[0]).join('、') || '主題一、主題二'}`,
      `- 語言：${d.lang || 'zh-Hant-TW'}`,
      '',
      '## 主要頁面',
      '',
      ...pages.map(p => `- [${truncUnits(p.text, 60)}](${p.href})`),
      '',
      '## 選用',
      '',
      `- [網站地圖](${origin}/sitemap.xml)`
    ].join('\n');

    const today = new Date().toISOString().slice(0, 10);
    const smUrls = [pageUrl, ...pages.map(p => p.href)].filter((v, i, a) => a.indexOf(v) === i).slice(0, 20);
    const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      smUrls.map(u => `  <url>\n    <loc>${esc(u)}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`).join('\n') + '\n</urlset>';

    return {
      head, org: JSON.stringify(orgLd, null, 2), breadcrumb: JSON.stringify(bcLd, null, 2),
      article: JSON.stringify(articleLd, null, 2), robots, llms, sitemap
    };
  }

  function faqJsonLd(items) {
    return JSON.stringify({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: items.filter(i => clean(i.q) && clean(i.a)).map(i => ({
        '@type': 'Question', name: clean(i.q),
        acceptedAnswer: { '@type': 'Answer', text: clean(i.a) }
      }))
    }, null, 2);
  }
  function faqHtml(items) {
    const rows = items.filter(i => clean(i.q) && clean(i.a)).map(i =>
      `  <details>\n    <summary><h3>${esc(clean(i.q))}</h3></summary>\n    <p>${esc(clean(i.a))}</p>\n  </details>`).join('\n');
    return `<section id="faq" aria-labelledby="faq-title">\n  <h2 id="faq-title">常見問題</h2>\n${rows}\n</section>`;
  }

  global.SeoAudit = { run, snippets, faqJsonLd, faqHtml, units, truncUnits, wordCount, esc, AI_BOTS };
})(window);
