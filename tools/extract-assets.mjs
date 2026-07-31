/**
 * 從 素材圖.png 萃取美術素材與設計 token。
 *
 * 素材圖是 1536x1024 的扁平合成圖（白底、含中文標籤）。本腳本：
 *   1. 以 flood-fill 偵測各區塊內的獨立物件，裁切、去白底、輸出透明 PNG
 *   2. 取樣色票，產生 client/src/styles/tokens.css
 *
 * 只裁切「小尺寸顯示仍銳利」的素材（LOGO / 頭像 / 圖示）。
 * 卡牌、按鈕、面板、桌布因為需要大尺寸與 108 種變體，改由 SVG/CSS 重建。
 *
 * 用法：npm run extract-assets
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, '素材圖.png');
const OUT = join(ROOT, 'client', 'public', 'assets');

/** 素材圖上各區塊的座標（x, y, w, h）與該區塊預期的物件數 */
const ZONES = {
  logo: { box: [6, 7, 220, 180], single: true },
  avatars: { box: [1105, 45, 400, 270], rows: 3, cols: 4, size: 128 },
  icons: { box: [672, 55, 400, 195], rows: 3, cols: 6, size: 96 },
};

const AVATAR_NAMES = [
  'boy', 'girl', 'shiba', 'cat',
  'penguin', 'dino', 'bear', 'rabbit',
  'headset', 'robot', 'frog', 'chick',
];

const ICON_NAMES = [
  'trophy', 'gear', 'sound', 'music', 'mic', 'help',
  'users', 'chat', 'alert', 'clock', 'wifi', 'exit',
  'shield', 'crown', 'star', 'gift', 'shop', 'store',
];

// ---------------------------------------------------------------- raw helpers

const src = sharp(SRC).ensureAlpha();
const { data: PIX, info: INFO } = await src.raw().toBuffer({ resolveWithObject: true });
const { width: IW, channels: CH } = INFO;

const px = (x, y) => {
  const p = (y * IW + x) * CH;
  return [PIX[p], PIX[p + 1], PIX[p + 2]];
};
/** 離白色的距離：0 = 純白 */
const whiteDist = (x, y) => {
  const [r, g, b] = px(x, y);
  return Math.max(255 - r, 255 - g, 255 - b);
};

// ------------------------------------------------------- background keying

const BG_T = 12; // 這個距離內視為背景白
const EDGE_T = 55; // 邊緣羽化的距離上限

/**
 * 裁切一塊區域並去除「從邊界連通進來的白色」。
 * 物件內部的白（眼睛、白貓、白色描邊）會被保留 —— 這是不能用單純 white-key 的原因。
 */
function cutout(x0, y0, w, h) {
  const n = w * h;
  const bg = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;

  const push = (i) => {
    if (!bg[i]) { bg[i] = 1; stack[sp++] = i; }
  };
  for (let x = 0; x < w; x++) {
    if (whiteDist(x0 + x, y0) <= BG_T) push(x);
    if (whiteDist(x0 + x, y0 + h - 1) <= BG_T) push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    if (whiteDist(x0, y0 + y) <= BG_T) push(y * w);
    if (whiteDist(x0 + w - 1, y0 + y) <= BG_T) push(y * w + w - 1);
  }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (!bg[ni] && whiteDist(x0 + nx, y0 + ny) <= BG_T) push(ni);
    }
  }

  // alpha：背景 0、鄰接背景的像素依「離白距離」羽化、其餘 255
  const out = Buffer.alloc(n * 4);
  const nearBg = (x, y) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (bg[ny * w + nx]) return true;
      }
    }
    return false;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      const [r, g, b] = px(x0 + x, y0 + y);
      if (bg[i]) { out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 0; continue; }
      let a = 255;
      if (nearBg(x, y)) {
        a = Math.min(255, Math.round((whiteDist(x0 + x, y0 + y) / EDGE_T) * 255));
      }
      if (a === 0) { out[o + 3] = 0; continue; }
      // un-premultiply：抵銷邊緣被白底稀釋造成的白邊
      const f = a / 255;
      out[o] = Math.max(0, Math.min(255, Math.round((r - 255 * (1 - f)) / f)));
      out[o + 1] = Math.max(0, Math.min(255, Math.round((g - 255 * (1 - f)) / f)));
      out[o + 2] = Math.max(0, Math.min(255, Math.round((b - 255 * (1 - f)) / f)));
      out[o + 3] = a;
    }
  }
  return { buf: out, w, h };
}

/** 找出區塊內所有非白連通元件的 bbox（用來自動對齊網格，避免手填座標） */
function components(x0, y0, w, h, minArea) {
  const n = w * h;
  const seen = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const boxes = [];
  for (let s = 0; s < n; s++) {
    const sx = s % w, sy = (s / w) | 0;
    if (seen[s] !== -1 || whiteDist(x0 + sx, y0 + sy) <= 24) continue;
    const id = boxes.length;
    let sp = 0;
    stack[sp++] = s; seen[s] = id;
    let a = 0, bx0 = w, by0 = h, bx1 = 0, by1 = 0;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w, y = (i / w) | 0;
      a++;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
      if (y < by0) by0 = y; if (y > by1) by1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (seen[ni] === -1 && whiteDist(x0 + nx, y0 + ny) > 24) { seen[ni] = id; stack[sp++] = ni; }
      }
    }
    boxes.push({ x: bx0 + x0, y: by0 + y0, w: bx1 - bx0 + 1, h: by1 - by0 + 1, area: a });
  }
  return boxes.filter((b) => b.area >= minArea);
}

/** 依 rows x cols 把元件排成閱讀順序（先分列再依 x 排） */
function toGrid(boxes, rows, cols) {
  const sorted = [...boxes].sort((a, b) => a.y - b.y);
  const bands = [];
  for (const b of sorted) {
    const band = bands.find((r) => Math.abs(r.y - b.y) < 40);
    if (band) { band.items.push(b); band.y = Math.min(band.y, b.y); }
    else bands.push({ y: b.y, items: [b] });
  }
  bands.sort((a, b) => a.y - b.y);
  const out = [];
  for (const band of bands.slice(0, rows)) {
    band.items.sort((a, b) => a.x - b.x);
    out.push(...band.items.slice(0, cols));
  }
  return out;
}

async function save(cut, size, file) {
  await sharp(cut.buf, { raw: { width: cut.w, height: cut.h, channels: 4 } })
    .trim({ threshold: 1 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(file);
}

// ------------------------------------------------------------------ palette

/** 區域內飽和度最高 25% 像素的中位色 —— 比單點取樣穩定 */
function dominant(x, y, w, h) {
  const list = [];
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
    const [r, g, b] = px(xx, yy);
    list.push({ r, g, b, s: Math.max(r, g, b) - Math.min(r, g, b) });
  }
  list.sort((a, b) => b.s - a.s);
  const top = list.slice(0, Math.max(1, (list.length * 0.25) | 0));
  const m = (k) => top.map((o) => o[k]).sort((a, b) => a - b)[top.length >> 1];
  return '#' + [m('r'), m('g'), m('b')].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

const SAMPLES = {
  'red': [32, 258, 20, 20],
  'yellow': [117, 258, 20, 20],
  'green': [203, 258, 20, 20],
  'blue': [287, 258, 20, 20],
  'violet': [372, 258, 20, 20],
  'btn-gold': [500, 320, 30, 12],
  'btn-green': [665, 320, 30, 12],
  'btn-blue': [822, 320, 30, 12],
  'btn-violet': [495, 385, 30, 12],
  'btn-pink': [615, 385, 30, 12],
  'btn-sky': [858, 385, 30, 12],
  'felt-green': [835, 825, 30, 30],
  'felt-blue': [938, 825, 30, 30],
  'felt-pink': [1041, 825, 30, 30],
  'felt-wood': [1144, 825, 30, 30],
  'felt-violet': [1247, 825, 30, 30],
  'brand-pink': [250, 35, 60, 20],
  'brand-violet': [250, 88, 60, 18],
  'section-blue': [700, 30, 40, 12],
};

// ---------------------------------------------------------------------- run

await mkdir(join(OUT, 'avatars'), { recursive: true });
await mkdir(join(OUT, 'icons'), { recursive: true });

// LOGO
{
  const [x, y, w, h] = ZONES.logo.box;
  const cut = cutout(x, y, w, h);
  await sharp(cut.buf, { raw: { width: w, height: h, channels: 4 } })
    .trim({ threshold: 1 })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, 'logo.png'));
  console.log('✓ logo.png');
}

// 頭像
{
  const { box: [x, y, w, h], rows, cols, size } = ZONES.avatars;
  const grid = toGrid(components(x, y, w, h, 1500), rows, cols);
  if (grid.length !== AVATAR_NAMES.length) {
    console.warn(`⚠ 偵測到 ${grid.length} 個頭像，預期 ${AVATAR_NAMES.length}`);
  }
  for (let i = 0; i < grid.length; i++) {
    const b = grid[i];
    const pad = 3;
    const cut = cutout(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    const name = AVATAR_NAMES[i] ?? `avatar-${i}`;
    await save(cut, size, join(OUT, 'avatars', `${name}.png`));
  }
  console.log(`✓ avatars/ (${grid.length})`);
}

// 圖示
{
  const { box: [x, y, w, h], rows, cols, size } = ZONES.icons;
  const grid = toGrid(components(x, y, w, h, 500), rows, cols);
  if (grid.length !== ICON_NAMES.length) {
    console.warn(`⚠ 偵測到 ${grid.length} 個圖示，預期 ${ICON_NAMES.length}`);
  }
  for (let i = 0; i < grid.length; i++) {
    const b = grid[i];
    const pad = 2;
    const cut = cutout(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    const name = ICON_NAMES[i] ?? `icon-${i}`;
    await save(cut, size, join(OUT, 'icons', `${name}.png`));
  }
  console.log(`✓ icons/ (${grid.length})`);
}

// 色票
{
  const c = Object.fromEntries(Object.entries(SAMPLES).map(([k, v]) => [k, dominant(...v)]));
  const css = `/* 由 tools/extract-assets.mjs 從 素材圖.png 取樣產生 —— 請勿手改，改座標後重跑 npm run extract-assets */
:root {
  /* 卡牌四色 + 紫（取自 CARD 區） */
  --c-red: ${c.red};
  --c-yellow: ${c.yellow};
  --c-green: ${c.green};
  --c-blue: ${c.blue};
  --c-violet: ${c.violet};

  /* 各色的深色描邊 / 陰影（由主色壓暗） */
  --c-red-dark: #B41F33;
  --c-yellow-dark: #C48A00;
  --c-green-dark: #4A9410;
  --c-blue-dark: #0B4E9E;
  --c-violet-dark: #6E2CA0;

  /* 按鈕（取自 BUTTON 區） */
  --btn-gold: ${c['btn-gold']};
  --btn-green: ${c['btn-green']};
  --btn-blue: ${c['btn-blue']};
  --btn-violet: ${c['btn-violet']};
  --btn-pink: ${c['btn-pink']};
  --btn-sky: ${c['btn-sky']};

  /* 桌布（取自 TABLE BACKGROUND 區） */
  --felt-green: ${c['felt-green']};
  --felt-blue: ${c['felt-blue']};
  --felt-pink: ${c['felt-pink']};
  --felt-wood: ${c['felt-wood']};
  --felt-violet: ${c['felt-violet']};

  /* 遊戲桌面漸層（取自 GAME TABLE 示意圖） */
  --table-in: #7559CC;
  --table-out: #4B3EA0;

  /* 品牌字色 */
  --brand-pink: ${c['brand-pink']};
  --brand-violet: ${c['brand-violet']};
  --section-blue: ${c['section-blue']};

  /* 中性色 */
  --ink: #2C2A3B;
  --ink-soft: #6B6880;
  --ink-faint: #A6A2B8;
  --paper: #FFFFFF;
  --paper-2: #F6F4FB;
  --page-bg: #F3EFFB;
  --line: #E6E1F2;
  --black-card: #1E1C22;

  /* 泡泡糖玩具風的共用形狀語彙 */
  --r-sm: 10px;
  --r-md: 16px;
  --r-lg: 24px;
  --r-pill: 999px;
  --ring: 4px; /* 厚白描邊 */
  --lift: 0 6px 0 rgba(0, 0, 0, 0.16); /* 底部硬陰影 */
  --lift-sm: 0 3px 0 rgba(0, 0, 0, 0.16);
  --soft: 0 8px 20px rgba(76, 58, 140, 0.18);
}
`;
  const dest = join(ROOT, 'client', 'src', 'styles', 'tokens.css');
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, css, 'utf8');
  console.log('✓ client/src/styles/tokens.css');
}
