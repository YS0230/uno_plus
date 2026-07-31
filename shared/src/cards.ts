/** 卡牌模型與牌堆建構。前後端共用。 */

export const COLORS = ['red', 'yellow', 'green', 'blue'] as const;
export type CardColor = (typeof COLORS)[number];

export type CardKind =
  | 'number'
  | 'skip'
  | 'reverse'
  | 'draw2'
  | 'wild'
  | 'wild4';

/** wild / wild4 的 color 為 null（黑牌），其餘必為四色之一 */
export interface Card {
  id: string;
  color: CardColor | null;
  kind: CardKind;
  /** 只有 kind === 'number' 時存在，0–9 */
  value?: number;
}

export const isWild = (c: Card): boolean => c.kind === 'wild' || c.kind === 'wild4';

/** 一副標準 UNO：108 張 */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  let n = 0;
  const add = (color: CardColor | null, kind: CardKind, value?: number) => {
    deck.push(value === undefined ? { id: `c${n++}`, color, kind } : { id: `c${n++}`, color, kind, value });
  };

  for (const color of COLORS) {
    add(color, 'number', 0); // 0 每色一張
    for (let v = 1; v <= 9; v++) {
      add(color, 'number', v);
      add(color, 'number', v); // 1–9 每色兩張
    }
    for (const kind of ['skip', 'reverse', 'draw2'] as const) {
      add(color, kind);
      add(color, kind); // 功能牌每色兩張
    }
  }
  for (let i = 0; i < 4; i++) add(null, 'wild');
  for (let i = 0; i < 4; i++) add(null, 'wild4');

  return deck;
}

/** Fisher–Yates。傳入 rng 方便測試時固定亂數。 */
export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 給 UI 用的顯示文字，例如 "紅色 7"、"綠色 迴轉" */
export function describeCard(card: Card): string {
  const colorText: Record<CardColor, string> = {
    red: '紅色',
    yellow: '黃色',
    green: '綠色',
    blue: '藍色',
  };
  const kindText: Record<CardKind, string> = {
    number: '',
    skip: '跳過',
    reverse: '迴轉',
    draw2: '抽兩張',
    wild: '變色',
    wild4: '變色抽四張',
  };
  const c = card.color ? colorText[card.color] : '';
  return card.kind === 'number' ? `${c} ${card.value}` : `${c} ${kindText[card.kind]}`.trim();
}
