# 測試室預約小工具

GitHub Pages + Google Sheets 的輕量級會議室預約系統，無需伺服器，零費用部署。

## 功能

- **預約會議** — 週曆檢視（週一～週五，09:00–19:00，每 30 分鐘一格），點擊空白時段即可預約單一測試室
- **我的預約** — 以員工編號查詢歷史預約，可編輯或取消
- **修改預約** — 從週曆點擊已預約時段（需輸入員編驗證），或從「我的預約」進入（免再次輸入）
- **可預約範圍** — 今日起至下週五，截止日每週自動滾動
- **離線模式** — `GAS_URL` 留空時自動使用 localStorage 模擬後端（方便本地測試）

## 快速開始

### 1. 啟用 GitHub Pages

1. 進入 GitHub 儲存庫 **Settings > Pages**
2. Source 選 **Deploy from a branch**
3. Branch 選 `main`，目錄選 `/ (root)`
4. 儲存後約 1 分鐘即可存取：`https://<你的帳號>.github.io/meeting-room-booking/`

### 2. 設定 Google Sheets 後端（可選，若需持久化資料）

#### 建立試算表

1. 開啟 [Google Sheets](https://sheets.google.com)，建立新試算表
2. 點選「**擴充功能 > Apps Script**」
3. 刪除預設程式碼，貼入 `gas/Code.gs` 的全部內容
4. 儲存（Ctrl+S）

#### 初始化工作表與觸發器

1. 在 Apps Script 編輯器，執行 `setupSheets()` 函式
2. 允許必要的權限
3. 確認試算表已出現 `bookings`（預約紀錄）與 `rooms`（會議室）兩個工作表
4. 執行 `setupTriggers()` 函式，建立「每天凌晨 2 點自動清理 14 天前預約」的觸發器（不執行此步驟就不會自動清理）

#### 部署為 Web App

1. 點選右上角「**部署 > 新增部署**」
2. 類型選「**網頁應用程式**」
3. 執行身分：**我**
4. 存取權限：**所有人**（必須，才能讓前端呼叫）
5. 點選「**部署**」，複製產生的 Web App URL

#### 連接前端

開啟 `src/config.js`，將 URL 填入：

```js
GAS_URL: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec',
```

> ⚠️ **Fork 本專案後必須換成自己部署的 Web App URL。** repo 內附的 URL 是原作者的部署，沿用會把資料寫進原作者的試算表。若想先在本地測試，將 `GAS_URL` 設為空字串 `''` 即可使用離線模擬模式。

提交並推送後，網站即完成與 Google Sheets 的整合。

## 自訂會議室

本系統為單一會議室設計，修改 `src/config.js` 的 `ROOM`：

```js
ROOM: { id: 'R01', name: '測試室', capacity: 10, floor: '3F', features: ['投影機', '白板'] },
```

> 後端 `rooms` 工作表目前僅作為資料保留，前端不會讀取，修改它不影響網頁顯示。

## 自訂時段

修改 `src/config.js` 的 `START_HOUR` 與 `END_HOUR`（整點，24 小時制）。時段以 30 分鐘為單位自動產生；可預約截止日固定為「下週五」，由程式每週自動計算。

## 檔案結構

```
meeting-room-booking/
├── index.html          # 主頁面
├── src/
│   ├── config.js       # 設定（GAS URL、會議室、時段）
│   ├── style.css       # 樣式
│   └── app.js          # 前端邏輯
└── gas/
    └── Code.gs         # Google Apps Script 後端
```

## 技術說明

- 純原生 HTML/CSS/JS，無任何框架依賴
- Google Apps Script 作為 REST API（CORS 透過 GET 參數傳遞）
- 離線/測試模式使用 localStorage 模擬後端
- RWD 支援行動裝置
- 公開 API 不回傳員工編號（員編為修改/取消憑證，驗證一律由後端比對）
