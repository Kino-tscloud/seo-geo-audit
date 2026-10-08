# SEO / GEO 網站健檢工具

純靜態網站（HTML / CSS / JS），網址：https://kino-tscloud.github.io/seo-geo-audit/

## 檔案結構
```
index.html        首頁（工具本體）
css/style.css     樣式（含深色模式、手機版、列印樣式）
js/audit.js       健檢引擎：11 大類、約 70 項檢查與評分、程式碼產生
js/app.js         介面：抓取網址、渲染報告、匯出 Markdown/JSON
js/demo.js        範例頁面資料
images/           logo、favicon、og-cover
robots.txt / llms.txt
```

## 使用方式
- **網址檢測**：透過公開 CORS 代理（allorigins / corsproxy.io / codetabs）讀取頁面與 robots.txt、sitemap.xml、llms.txt。
- **貼上原始碼**：網站擋代理時使用，在目標頁按 Ctrl+U 複製原始碼貼上。
- 支援網址參數：`index.html?url=https://example.com&kw=關鍵字`

## 資料庫（Supabase）
- 資料表 `audits`：使用者按「分享」才寫入的公開檢測紀錄（網址、關鍵字、三項分數、備註）。
- RLS：任何人可讀取、可新增；不開放修改與刪除；欄位有長度與分數範圍限制。
- 網頁只使用可公開的 Publishable key（寫在 index.html 底部的 module script），不含任何 secret / service_role key。
