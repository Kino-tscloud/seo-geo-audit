/* 範例頁面：刻意混合優點與缺點，用來展示健檢結果 */
window.DEMO_PAGE = {
  url: 'https://www.example-dental.tw/services/implant',
  keyword: '植牙',
  robots: 'User-agent: *\nDisallow: /admin/\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /\n',
  html: `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>植牙</title>
<meta name="description" content="微笑牙醫診所提供植牙服務，歡迎預約。">
<meta name="keywords" content="植牙,人工植牙,植牙費用,植牙推薦,台北植牙,植牙價格,全口植牙,植牙優惠,植牙診所,植牙醫生,植牙流程,植牙後注意事項,植牙痛嗎,植牙保固">
<meta property="og:title" content="植牙｜微笑牙醫">
<meta property="og:type" content="website">
<link rel="stylesheet" href="/css/main.css">
<script src="https://cdn.example.com/jquery.min.js"></script>
<script src="/js/slider.js"></script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Dentist",
  "name": "微笑牙醫診所",
  "telephone": "02-1234-5678",
  "url": "https://www.example-dental.tw/"
}
</script>
</head>
<body>
<header><nav><a href="/">首頁</a> <a href="/services">服務項目</a> <a href="/doctors">醫師團隊</a> <a href="/contact">聯絡我們</a></nav></header>
<main>
<h1>植牙</h1>
<img src="/images/implant-hero.jpg">
<p>植牙是一種以人工牙根取代缺失牙齒的治療方式，透過鈦金屬植體與齒槽骨結合，恢復約 90% 以上的咀嚼功能。</p>
<h3>植牙流程</h3>
<ol><li>術前諮詢與 3D 斷層掃描</li><li>植入人工牙根</li><li>等待骨整合 3 到 6 個月</li><li>裝上假牙牙冠</li></ol>
<h2>植牙費用多少錢？</h2>
<p>植牙費用依植體品牌與骨粉需求而定，單顆約 6 萬至 10 萬元。</p>
<h2>植牙會痛嗎？</h2>
<p>植牙手術全程局部麻醉，多數患者表示疼痛程度與拔牙相近，術後 2 到 3 天會有輕微腫脹。</p>
<h4>植牙後注意事項</h4>
<p>術後 24 小時內避免漱口與熱食，並依醫囑服藥。</p>
<img src="/images/doctor.png" alt="林醫師">
<p>想了解更多？<a href="/contact">點此</a> 或 <a href="https://www.facebook.com/example" target="_blank">追蹤粉專</a>。</p>
</main>
<footer><p>© 微笑牙醫診所 台北市信義區</p></footer>
</body>
</html>`
};
