/**
 * SVG 需要具體色碼（無法吃 CSS 變數的 gradient stop），
 * 因此把 tokens.css 的取樣值鏡射一份到這裡。
 * 改色請先改 tools/extract-assets.mjs 的取樣座標並重跑，再同步這份。
 */
import type { CardColor } from '@uno/shared';

export interface Swatch {
  /** 主色 */
  base: string;
  /** 漸層亮部 */
  light: string;
  /** 描邊與陰影用的暗部 */
  dark: string;
}

export const CARD_PALETTE: Record<CardColor, Swatch> = {
  red: { base: '#F43F48', light: '#FF6B70', dark: '#B41F33' },
  yellow: { base: '#FED706', light: '#FFE873', dark: '#C48A00' },
  green: { base: '#75D223', light: '#9BE84E', dark: '#4A9410' },
  blue: { base: '#1379DF', light: '#4EA6F5', dark: '#0B4E9E' },
};

/** 黑牌（wild / wild4 / 卡背） */
export const BLACK_CARD: Swatch = { base: '#1E1C22', light: '#3A3742', dark: '#000000' };

export const COLOR_LABEL: Record<CardColor, string> = {
  red: '紅色',
  yellow: '黃色',
  green: '綠色',
  blue: '藍色',
};

export const swatchOf = (color: CardColor | null): Swatch =>
  color ? CARD_PALETTE[color] : BLACK_CARD;
