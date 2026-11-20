# 知識尋寶《Lode Runner》

致敬 1980 年代經典《Lode Runner（淘金者）》的 2D 網格動作益智（2.5D 視覺質感）純前端 SPA / PWA 網頁遊戲，整合三大個人知識品牌：

1. 🌿 **【捻花惹草】**：看圖四選一花草植物鑑別（15 秒，圖片預載完成才開始倒數）
2. 🔢 **【數獨共享平台】**：直覺局部殘局填空（45 秒，每關 5～7 格唯一推導解）
3. 🩺 **【加減學學】**：家醫科生活醫學觀念題（15 秒，附張醫師小叮嚀解析）

## 操作方式

- **電腦鍵盤**：`方向鍵` / `WASD` 移動、爬梯、吊鋼索（在鋼索按 `下` 放手）；`Z` / `Q` / `J` 往左下方挖洞；`X` / `E` / `K` 往右下方挖洞；`P` / `Esc` 暫停；`R` 重試本關。
- **手機觸控**：畫面下方左側十字鍵控制移動，右側「左挖」「右挖」按鈕挖掘磚塊。

## 題庫更新與維護

### 1. 重新匯入【捻花惹草】與【數獨】題庫
若本機 `D:\antigravity\plants` 或 `D:\antigravity\Sudoku miner` 有新增資料，可執行：
```bash
node scripts/extract_data.mjs
```
會自動重新萃取並驗證 `data/plants.json` 與 `data/sudoku.json`。

### 2. 審閱【加減學學】家醫衛教題庫與補上 YouTube 連結
請開啟 `data/medical.json`（目前內含 30 題，分為運動生理、睡眠衛生、營養保健、用藥安全、慢性病與急救五大類），可直接修改題文、解析，或於各題的 `"videoUrl"` 欄位填入對應的 YouTube 影片網址（玩家答題解析或過關回顧頁會直接顯示導流按鈕）。

### 3. 驗證關卡可達性
```bash
node scripts/verify_levels.mjs
```

### 4. 預留雲端 GAS / API 擴充
可於 `js/config.js` 的 `API_ENDPOINTS` 填入 Google Apps Script Web App 網址，遊戲啟動時將自動嘗試同步擴充題庫（離線或逾時會自動退回本地 JSON）。

## 部署至 GitHub Pages

本專案為零建置純前端靜態檔案，直接推送至 GitHub 儲存庫並啟用 GitHub Pages 即可遊玩（支援 PWA 安裝）。

---
@2026 by Famidoc Chang & Antigravity
