/**
 * 開發用：把 UnoCard 實際渲染出來的 SVG 光柵化成 PNG，方便在沒有瀏覽器時檢查卡面。
 * 用法：npx tsx tools/preview-cards.tsx <輸出路徑.png>
 */
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { createElement } from 'react';
import { buildDeck } from '../shared/src/index.ts';
import { UnoCard } from '../client/src/components/UnoCard.tsx';

// UnoCard.css 裡的字級規則要塞進 SVG，librsvg 才吃得到
const SVG_CSS = `
.uno-card__value{font:900 96px/1 'Avenir Next','Nunito',sans-serif;letter-spacing:-0.04em}
.uno-card__badge{font:900 40px/1 'Avenir Next','Nunito',sans-serif}
.uno-card__corner{font:900 34px/1 'Avenir Next','Nunito',sans-serif}
.uno-card__logo{font:italic 900 44px/1 'Avenir Next','Nunito',sans-serif}
`;

const CW = 140;
const CH = 200;

function rasterize(node: React.ReactElement, w: number, h: number) {
  let svg = renderToStaticMarkup(node);
  svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  svg = svg.replace('>', `><style>${SVG_CSS}</style>`);
  return sharp(Buffer.from(svg), { density: 200 }).resize(w, h).png().toBuffer();
}

const out = process.argv[2] ?? 'cards.png';
const deck = buildDeck();

// 每種牌各挑一張代表，加上卡背
const picks = [
  ...['red', 'yellow', 'green', 'blue'].flatMap((c) =>
    [0, 5, 9].map((v) => deck.find((d) => d.color === c && d.kind === 'number' && d.value === v)!),
  ),
  ...['red', 'yellow', 'green', 'blue'].flatMap((c) =>
    (['skip', 'reverse', 'draw2'] as const).map((k) => deck.find((d) => d.color === c && d.kind === k)!),
  ),
  deck.find((d) => d.kind === 'wild')!,
  deck.find((d) => d.kind === 'wild4')!,
];

const COLS = 6;
const CARD_W = 150;
const CARD_H = Math.round((CARD_W * CH) / CW);
const GAP = 14;
const rows = Math.ceil((picks.length + 1) / COLS);

const tiles = await Promise.all([
  ...picks.map((c) => rasterize(createElement(UnoCard, { card: c }), CARD_W, CARD_H)),
  rasterize(createElement(UnoCard, { faceDown: true }), CARD_W, CARD_H),
]);

const W = COLS * (CARD_W + GAP) + GAP;
const H = rows * (CARD_H + GAP) + GAP;

await sharp({ create: { width: W, height: H, channels: 4, background: { r: 245, g: 240, b: 255, alpha: 1 } } })
  .composite(
    tiles.map((input, i) => ({
      input,
      left: GAP + (i % COLS) * (CARD_W + GAP),
      top: GAP + Math.floor(i / COLS) * (CARD_H + GAP),
    })),
  )
  .png()
  .toFile(out);

console.log(`✓ ${out} (${tiles.length} 張)`);
