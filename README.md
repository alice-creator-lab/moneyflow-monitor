# 賽馬熱錢流 · Phase 0 監察頁（靜態快照）

香港賽馬會公開賠率／彩池投注額的個人研究用監察頁。

本 repo 由本機 collector 定時產生（`build_pages.py` + `pages_push.sh`），**唔係即時數據**——
每次 commit 就係一次快照，內容同 `data.js` 一致。要即時（20 秒級）版本就要跑本機 server。

- `index.html` — 單頁儀表板（零依賴）
- `static/app.js`、`static/style.css` — 前端
- `data.js` — 快照數據（`window.MF_STATIC`）

只供個人研究，非投注建議；數據版權屬香港賽馬會，不得轉載或轉售。
