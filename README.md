# UNO PLUS — 泡泡糖玩具風網頁版 UNO

即時多人連線的網頁版 UNO，支援 AI 玩家、斷線重連、聊天室與完整 UNO 規則。
視覺依照 `素材圖.png` 的「泡泡糖玩具風」重建。

## 快速開始

```bash
npm install
npm run dev        # server :3001 + client :5173
```

打開 <http://localhost:5173>。開兩個分頁（其中一個用無痕視窗，才會是不同玩家）就能互相對戰。

其他指令：

```bash
npm test              # 規則引擎 + 對局引擎 + 端對端 socket 測試（65 項）
npm run typecheck     # 全專案型別檢查
npm run build         # 打包前端到 client/dist
npm start             # 正式模式（Express 同時托管前端與 WebSocket）
npm run extract-assets # 重新從 素材圖.png 萃取素材與色票
```

## 專案結構

```
shared/src/     規則引擎與型別 —— 前端、伺服器、AI 共用的唯一事實來源
  cards.ts        108 張牌的牌堆建構
  rules.ts        canPlay / applyEffect / 抽牌重洗 / 計分
  types.ts        GameView / RoomView 等狀態型別
  protocol.ts     Socket 事件協定

server/src/     權威伺服器
  game.ts         GameEngine：對局狀態機、UNO 緩衝與抓捕計時、視角裁切
  rooms.ts        房間登錄、密碼、房主權限
  sessions.ts     sessionToken ↔ 座位（重連用）
  ai.ts           普通難度 AI 決策
  handlers.ts     Socket 事件路由
  index.ts        Express + Socket.IO 入口

client/src/     React 前端
  components/     UnoCard（SVG 卡牌）、UI 元件庫
  screens/        Home / Lobby / CreateRoom / Room / Game / GameOver
  features/       聊天室、覆蓋層（吐司、被抓 UNO 彈窗、連線遮罩）
  audio/synth.ts  Web Audio 合成音效
  store.ts        zustand 狀態與動作

tools/          素材萃取與預覽腳本
```

## 美術素材

`素材圖.png` 是 1536×1024 的扁平合成圖（白底、含中文標籤），並不是可直接使用的素材包 ——
卡牌只有約 62×95px、頭像約 72px。因此採混合策略：

- **裁切成 PNG**（小尺寸顯示仍銳利）：LOGO、12 個頭像、18 個圖示
  由 `tools/extract-assets.mjs` 以 flood-fill 偵測物件邊界、去白底、羽化邊緣後輸出到 `client/public/assets/`。
  內部白色（白貓、眼睛、白色描邊）會被保留 —— 這是不能用單純 white-key 的原因。
- **用 SVG／CSS 重建**（需要大尺寸與 108 種變體）：卡牌、按鈕、面板、桌布、UNO 按鈕
  形狀語彙統一為：厚白描邊 + 大圓角 + 內漸層 + 底部硬陰影 + 白字深色描邊。

色票不是憑印象填的，是由同一支腳本從素材圖取樣後產生 `client/src/styles/tokens.css`。
要調整就改腳本裡的 `SAMPLES` 座標再重跑 `npm run extract-assets`。

### 沒有瀏覽器時怎麼檢查畫面

```bash
# 把 UnoCard 渲染出來的 SVG 光柵化成 PNG，檢查卡面
node --import tsx --import ./tools/register-css.mjs tools/preview-cards.tsx out.png

# 用 headless Chrome 驅動真的 UI，自動打完一局並截下每個畫面
npm start &                       # 需要先 npm run build
node tools/shoot.mjs ./shots
```

`tools/shoot.mjs` 會自動走完 建房 → 加 AI → 開局 → 出牌 → 結算，
並輸出首頁、說明、創房、房間、牌桌（桌機與手機）、UNO 按鈕、結算等截圖。

## UNO 按鈕機制

規格中最細的部分，全部由伺服器計時（前端只拿到絕對時間戳自行倒數）：

1. 玩家出牌後手上剩 1 張 → 開啟 **2 秒緩衝**，倒數立即開始
2. 緩衝期間**只有出牌者本人**能按 UNO，其他玩家的舉報一律被伺服器拒絕
3. 期間按下 → 安全，之後抓不到
4. 2 秒過了還沒按 → 其他玩家可以**抓 UNO**；本人此時也還能補喊自保，變成雙方搶時間
5. 抓捕視窗在**下一位玩家完成回合後**關閉；期間該玩家手牌一旦不再是 1 張也會立刻失效
6. 抓到 → 被抓者罰抽兩張，全房跳出醒目彈窗（含頭像、碎紙動畫與音效）

## 遊戲規則

標準 UNO：數字牌、Skip、Reverse、Draw Two、Wild、Wild Draw Four。
兩人對戰時 Reverse 等同 Skip。抽牌堆見底會保留棄牌堆頂張、其餘洗回。
`+2 可疊加` 是建房時的選項（預設關閉，符合經典規則）。

## 離線與重連

- 前端首次連線產生 `sessionToken` 存在 `localStorage`，每次 handshake 帶上
- 遊戲中斷線 → 保留座位 **60 秒**，期間重連可無縫接回原本的手牌
- 超過 60 秒 → 由 AI 接手該座位，遊戲繼續；本人之後重連仍可拿回控制權
- 還在房間等待階段時斷線則直接讓出座位，不佔位子

## 音效

沒有提供音檔，因此全部用 Web Audio 即時合成（出牌、抽牌、UNO、被抓、勝利、按鈕、輪到你、加入）。
零載入時間、離線可用。音效與背景音樂可分別開關，狀態存在 `localStorage`。
瀏覽器的 autoplay 政策要求先有使用者互動，因此第一次點擊／按鍵才會解鎖音訊。

## 部署到 Render

repo 內已有 `render.yaml`，在 Render 建立 Blueprint 或 Web Service 即可：

- Build：`npm ci && npm run build`
- Start：`npm start`
- Health check：`/healthz`

Express 在正式模式會靜態托管 `client/dist` 並對非 API 路徑回傳 `index.html`（SPA fallback），
Socket.IO 與 HTTP 共用 `process.env.PORT` —— Render Web Service 原生支援 WebSocket，不需額外設定。

**已知取捨**：房間狀態放在記憶體，Render free tier 休眠或重啟會清空所有房間；
冷啟動第一次連線可能需要約 30 秒，前端的連線遮罩已針對這點做提示。
