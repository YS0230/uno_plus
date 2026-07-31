/**
 * 全部 108 張牌與卡背都由這一個元件渲染。
 *
 * 素材圖的卡牌只有 62x95px，放大到遊戲尺寸會糊掉，所以改用 SVG 依照
 * 它的形狀語彙重畫：厚白外框 + 傾斜白橢圓 + 白字深色描邊 + 底部硬陰影。
 */
import { memo, useId } from 'react';
import type { Card, CardColor } from '@uno/shared';
import { BLACK_CARD, CARD_PALETTE, swatchOf } from '../theme.ts';
import './UnoCard.css';

const W = 140;
const H = 200;
const VALUE_FONT = 96;

export type CardSize = 'xs' | 'sm' | 'md' | 'lg';

interface Props {
  card?: Card;
  faceDown?: boolean;
  size?: CardSize;
  /** 可出牌 —— 上浮並發光 */
  playable?: boolean;
  /** 不可出 —— 壓暗 */
  dimmed?: boolean;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  /** 手牌扇形展開的旋轉角 */
  rotate?: number;
  style?: React.CSSProperties;
}

// ------------------------------------------------------------- 功能牌符號

/** ⊘ 跳過 */
function SkipGlyph({ scale = 1, stroke = 'white' }: { scale?: number; stroke?: string }) {
  const r = 26 * scale;
  const t = 8 * scale;
  return (
    <g>
      <circle r={r} fill="none" stroke={stroke} strokeWidth={t} />
      <line x1={-r * 0.72} y1={r * 0.72} x2={r * 0.72} y2={-r * 0.72} stroke={stroke} strokeWidth={t} strokeLinecap="round" />
    </g>
  );
}

/** ⇅ 迴轉：兩支反向的直箭頭 */
function ReverseGlyph({ scale = 1, fill = 'white' }: { scale?: number; fill?: string }) {
  const s = scale;
  // 以原點為中心、朝上的箭頭：柄寬 10、頭寬 26、全高 52
  const up = `M ${-5 * s} ${26 * s} L ${-5 * s} ${-6 * s} L ${-13 * s} ${-6 * s} L 0 ${-26 * s} L ${13 * s} ${-6 * s} L ${5 * s} ${-6 * s} L ${5 * s} ${26 * s} Z`;
  return (
    <g fill={fill}>
      <path d={up} transform={`translate(${-13 * s} 0)`} />
      <path d={up} transform={`translate(${13 * s} 0) rotate(180)`} />
    </g>
  );
}

/** 兩張疊起來的小卡（+2） */
function Draw2Glyph({ scale = 1, color }: { scale?: number; color: CardColor | null }) {
  const s = scale;
  const sw = swatchOf(color);
  const w = 32 * s;
  const h = 46 * s;
  const r = 6 * s;
  return (
    <g>
      <rect
        x={-w / 2} y={-h / 2} width={w} height={h} rx={r}
        fill={sw.dark} stroke="white" strokeWidth={4 * s}
        transform={`translate(${-11 * s} ${2 * s}) rotate(-13)`}
      />
      <rect
        x={-w / 2} y={-h / 2} width={w} height={h} rx={r}
        fill={sw.base} stroke="white" strokeWidth={4 * s}
        transform={`translate(${11 * s} ${-2 * s}) rotate(11)`}
      />
    </g>
  );
}

/** 四色小卡（+4） */
function Wild4Glyph({ scale = 1 }: { scale?: number }) {
  const s = scale;
  const w = 20 * s;
  const h = 30 * s;
  const r = 4 * s;
  const cards: Array<[CardColor, number, number, number]> = [
    ['red', -18 * s, -2 * s, -14],
    ['blue', -6 * s, -8 * s, -5],
    ['yellow', 4 * s, -8 * s, 5],
    ['green', 14 * s, -2 * s, 14],
  ];
  return (
    <g>
      {cards.map(([c, x, y, rot]) => (
        <rect
          key={c}
          x={x - w / 2}
          y={y - h / 2}
          width={w}
          height={h}
          rx={r}
          fill={CARD_PALETTE[c].base}
          stroke="white"
          strokeWidth={2.6 * s}
          transform={`rotate(${rot} ${x} ${y})`}
        />
      ))}
    </g>
  );
}

/** 四色四分橢圓（Wild） */
function WildGlyph({ scale = 1 }: { scale?: number }) {
  const s = scale;
  const rx = 34 * s;
  const ry = 46 * s;
  const clip = useId();
  return (
    <g transform="rotate(-22)">
      <clipPath id={clip}>
        <ellipse rx={rx} ry={ry} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect x={-rx} y={-ry} width={rx} height={ry} fill={CARD_PALETTE.blue.base} />
        <rect x={0} y={-ry} width={rx} height={ry} fill={CARD_PALETTE.red.base} />
        <rect x={-rx} y={0} width={rx} height={ry} fill={CARD_PALETTE.yellow.base} />
        <rect x={0} y={0} width={rx} height={ry} fill={CARD_PALETTE.green.base} />
      </g>
      <ellipse rx={rx} ry={ry} fill="none" stroke="white" strokeWidth={5 * s} />
    </g>
  );
}

// ------------------------------------------------------------------ 角標

/**
 * 角標。不用 dominant-baseline —— 部分 SVG 渲染器（含光柵化工具）會忽略它，
 * 改成自己把基線推到視覺中心：baseline ≈ 中心 + 0.35 * 字級。
 */
const CORNER_FONT = 34;
const CORNER_BASELINE = CORNER_FONT * 0.35;

function CornerMark({ card }: { card: Card }) {
  const s = 0.3;
  const text = (t: string) => (
    <text className="uno-card__corner" x={0} y={CORNER_BASELINE} textAnchor="middle">
      {t}
    </text>
  );

  switch (card.kind) {
    case 'number': return text(String(card.value));
    case 'draw2': return text('+2');
    case 'wild4': return text('+4');
    case 'skip': return <SkipGlyph scale={s} />;
    case 'reverse': return <ReverseGlyph scale={s} />;
    default: return <WildGlyph scale={0.24} />;
  }
}

// ------------------------------------------------------------------- 主體

function CardFace({ card }: { card: Card }) {
  const sw = swatchOf(card.color);
  const gid = useId();
  const isBlack = card.color === null;
  const body = isBlack ? BLACK_CARD : sw;

  return (
    <>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={body.light} />
          <stop offset="55%" stopColor={body.base} />
          <stop offset="100%" stopColor={body.dark} />
        </linearGradient>
      </defs>

      {/* 厚白外框 */}
      <rect x={0} y={0} width={W} height={H} rx={20} fill="white" />
      {/* 卡面 */}
      <rect x={7} y={7} width={W - 14} height={H - 14} rx={15} fill={`url(#${gid})`} />
      {/* 上緣高光 */}
      <rect x={7} y={7} width={W - 14} height={(H - 14) * 0.42} rx={15} fill="white" opacity={0.14} />

      {/* 中央傾斜白橢圓（黑牌不畫，改由 glyph 自帶） */}
      {!isBlack && (
        <ellipse cx={W / 2} cy={H / 2} rx={44} ry={62} fill="white" transform={`rotate(-22 ${W / 2} ${H / 2})`} />
      )}

      {/* 中央主體 */}
      <g transform={`translate(${W / 2} ${H / 2})`}>
        {card.kind === 'number' && (
          <text
            className="uno-card__value"
            x={0}
            y={VALUE_FONT * 0.35}
            textAnchor="middle"
            fill="white"
            stroke={sw.dark}
            strokeWidth={7}
            paintOrder="stroke"
          >
            {card.value}
          </text>
        )}
        {card.kind === 'skip' && <SkipGlyph scale={1.05} stroke={sw.base} />}
        {card.kind === 'reverse' && <ReverseGlyph scale={1.05} fill={sw.base} />}
        {card.kind === 'draw2' && <Draw2Glyph scale={1.05} color={card.color} />}
        {card.kind === 'wild' && <WildGlyph scale={1} />}
        {card.kind === 'wild4' && <Wild4Glyph scale={1.15} />}
      </g>

      {/* 角標 */}
      <g transform="translate(26 22)" fill="white" stroke="none">
        <CornerMark card={card} />
      </g>
      <g transform={`translate(${W - 26} ${H - 22}) rotate(180)`} fill="white" stroke="none">
        <CornerMark card={card} />
      </g>
    </>
  );
}

function CardBack() {
  const gid = useId();
  return (
    <>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={BLACK_CARD.light} />
          <stop offset="60%" stopColor={BLACK_CARD.base} />
          <stop offset="100%" stopColor="#0B0A0D" />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={W} height={H} rx={20} fill="white" />
      <rect x={7} y={7} width={W - 14} height={H - 14} rx={15} fill={`url(#${gid})`} />
      <ellipse cx={W / 2} cy={H / 2} rx={52} ry={34} fill={CARD_PALETTE.red.base} transform={`rotate(-22 ${W / 2} ${H / 2})`} />
      <ellipse cx={W / 2} cy={H / 2} rx={52} ry={34} fill="none" stroke={CARD_PALETTE.red.dark} strokeWidth={3} transform={`rotate(-22 ${W / 2} ${H / 2})`} />
      <text
        className="uno-card__logo"
        x={W / 2}
        y={H / 2 + 15}
        textAnchor="middle"
        fill="white"
        stroke={CARD_PALETTE.red.dark}
        strokeWidth={3}
        paintOrder="stroke"
        transform={`rotate(-22 ${W / 2} ${H / 2})`}
      >
        UNO
      </text>
    </>
  );
}

export const UnoCard = memo(function UnoCard({
  card,
  faceDown = false,
  size = 'md',
  playable = false,
  dimmed = false,
  selected = false,
  onClick,
  className = '',
  rotate,
  style,
}: Props) {
  const showBack = faceDown || !card;
  const classes = [
    'uno-card',
    `uno-card--${size}`,
    playable && 'is-playable',
    dimmed && 'is-dimmed',
    selected && 'is-selected',
    onClick && 'is-clickable',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const label = showBack ? '蓋牌' : `${card!.color ?? '黑'} ${card!.kind} ${card!.value ?? ''}`;

  return (
    <svg
      className={classes}
      viewBox={`0 0 ${W} ${H}`}
      role={onClick ? 'button' : 'img'}
      aria-label={label}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      style={{ ...style, ...(rotate !== undefined ? { '--card-rotate': `${rotate}deg` } as React.CSSProperties : {}) }}
    >
      {showBack ? <CardBack /> : <CardFace card={card!} />}
    </svg>
  );
});
