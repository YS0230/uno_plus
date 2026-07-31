/**
 * 開發用：用 headless Chrome + CDP 驅動真的 UI，截下各畫面。
 * 用法：node tools/shoot.mjs <輸出資料夾> [baseUrl]
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import WebSocket from 'ws';

const OUT = process.argv[2] ?? './shots';
const BASE = process.argv[3] ?? 'http://localhost:3010';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;

await mkdir(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1280,860',
  '--user-data-dir=/tmp/uno-shoot-profile',
  BASE,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等 CDP 端點起來 */
async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/json`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* 還沒起來 */ }
    await sleep(250);
  }
  throw new Error('連不上 Chrome CDP');
}

const page = await targets();
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.on('open', r));

let seq = 0;
const pending = new Map();
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text + ' ' + expression);
  return res.result.value;
};

/** 依可見文字點擊按鈕 */
const clickText = (text) =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click();
    return true;
  })()`);

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`✓ ${name}.png`);
}

async function setViewport(width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile,
  });
}

await send('Page.enable');
await send('Runtime.enable');
await sleep(1500);

// ---------------------------------------------------------------- 各畫面

await shot('01-home');

await clickText('遊戲說明');
await sleep(400);
await shot('02-howto');
await clickText('←');
await sleep(300);

await clickText('建立房間');
await sleep(500);
await shot('03-create');

await clickText('創建');
await sleep(900);
await clickText('新增 AI');
await sleep(400);
await clickText('新增 AI');
await sleep(400);
await clickText('新增 AI');
await sleep(600);
await shot('04-room');

await clickText('開始遊戲');
await sleep(1200);
await shot('05-game');

// 手機尺寸
await setViewport(390, 844, true);
await sleep(600);
await shot('06-game-mobile');

await send('Emulation.clearDeviceMetricsOverride');
await setViewport(1280, 860);
await sleep(400);

/** 幫「真人」自動打牌：能出就出、要選色就選、剩一張就喊 UNO、不然抽牌 */
const autoPlayStep = () => evaluate(`(() => {
  const pick = document.querySelector('.picker__swatch');
  if (pick) { pick.click(); return 'color'; }

  const uno = document.querySelector('.unobtn');
  if (uno) { uno.click(); return 'uno'; }

  const catchBtn = document.querySelector('.oseat__catch');
  if (catchBtn) { catchBtn.click(); return 'catch'; }

  const card = document.querySelector('.hand__rail .uno-card.is-playable');
  if (card) { card.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 'play'; }

  const act = [...document.querySelectorAll('.mystatus .btn')][0];
  if (act) { act.click(); return 'act'; }

  return 'idle';
})()`);

let sawUno = false;
let sawCaught = false;
for (let i = 0; i < 400; i++) {
  if (await evaluate(`!!document.querySelector('.over')`)) break;

  if (!sawUno && (await evaluate(`!!document.querySelector('.unobtn')`))) {
    await shot('08-uno-button');
    sawUno = true;
  }
  if (!sawCaught && (await evaluate(`!!document.querySelector('.caught')`))) {
    await shot('09-uno-caught');
    sawCaught = true;
  }

  await autoPlayStep();
  await sleep(220);
}
await sleep(600);
await shot('07-gameover');

ws.close();
chrome.kill();
console.log('done');
process.exit(0);
