/**
 * UNO 規則引擎 —— 純函式，無副作用。
 *
 * 這份檔案是規則的唯一事實來源：
 *   - 前端用它算「手上哪些牌可以出」做提示
 *   - 伺服器用它做權威驗證（前端算的結果一律不信）
 *   - AI 用它評估選項
 */
import { COLORS, isWild, shuffle, type Card, type CardColor } from './cards.ts';

export interface Seat {
  id: string;
  hand: Card[];
}

/** 伺服器持有的完整對局狀態 */
export interface CoreState {
  seats: Seat[];
  /** seats 的索引 */
  turn: number;
  direction: 1 | -1;
  drawPile: Card[];
  /** 最後一張為棄牌堆頂 */
  discardPile: Card[];
  activeColor: CardColor | null;
  /** 疊加中尚未結算的抽牌數（stacking 關閉時恆為 0） */
  pendingDraw: number;
  stacking: boolean;
}

export const topCard = (s: CoreState): Card | null =>
  s.discardPile.length > 0 ? s.discardPile[s.discardPile.length - 1] : null;

/**
 * 這張牌現在能不能出。
 *
 * 疊加進行中（pendingDraw > 0）時規則收緊：只能再疊一張抽牌卡，
 * 否則就得吞下累積的張數。
 */
export function canPlay(card: Card, top: Card | null, activeColor: CardColor | null, pendingDraw = 0): boolean {
  if (!top) return true;

  if (pendingDraw > 0) {
    if (top.kind === 'wild4') return card.kind === 'wild4';
    if (top.kind === 'draw2') return card.kind === 'draw2' || card.kind === 'wild4';
    return false;
  }

  if (isWild(card)) return true;
  if (card.color === activeColor) return true;
  if (top.kind === 'number' && card.kind === 'number') return card.value === top.value;
  if (top.kind !== 'number' && card.kind === top.kind) return true;
  return false;
}

export function playableCards(hand: Card[], top: Card | null, activeColor: CardColor | null, pendingDraw = 0): Card[] {
  return hand.filter((c) => canPlay(c, top, activeColor, pendingDraw));
}

/** 從 turn 往 direction 走 step 步後的座位索引 */
export function seatAfter(state: CoreState, step = 1): number {
  const n = state.seats.length;
  return (((state.turn + state.direction * step) % n) + n) % n;
}

export const nextPlayerId = (state: CoreState): string => state.seats[seatAfter(state, 1)].id;

/**
 * 抽牌堆見底時，留下棄牌堆頂張，其餘洗回抽牌堆。
 * 若連棄牌堆都沒得洗（極端情況），就抽得到幾張算幾張。
 */
export function drawFromPile(state: CoreState, count: number, rng: () => number = Math.random): Card[] {
  const out: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (state.drawPile.length === 0) {
      if (state.discardPile.length <= 1) break;
      const top = state.discardPile.pop()!;
      state.drawPile = shuffle(state.discardPile, rng);
      state.discardPile = [top];
    }
    const card = state.drawPile.pop();
    if (!card) break;
    out.push(card);
  }
  return out;
}

export interface PlayOutcome {
  /** 出牌造成的效果，給上層決定要播什麼動畫／音效 */
  effect: 'none' | 'skip' | 'reverse' | 'draw';
  /** 被罰抽的玩家（stacking 關閉時立即結算） */
  drawTargetId: string | null;
  drawCount: number;
}

/**
 * 套用一張已通過驗證的牌，並把 turn 推到下一位。
 * 呼叫前必須已把牌從手上移除、推入棄牌堆、並設好 activeColor。
 */
export function applyEffect(state: CoreState, card: Card, rng: () => number = Math.random): PlayOutcome {
  const twoPlayers = state.seats.length === 2;

  switch (card.kind) {
    case 'reverse': {
      state.direction = (state.direction * -1) as 1 | -1;
      // 兩人時反轉等同跳過對手，回合仍留在自己
      state.turn = twoPlayers ? state.turn : seatAfter(state, 1);
      return { effect: 'reverse', drawTargetId: null, drawCount: 0 };
    }
    case 'skip': {
      state.turn = seatAfter(state, 2);
      return { effect: 'skip', drawTargetId: null, drawCount: 0 };
    }
    case 'draw2':
    case 'wild4': {
      const amount = card.kind === 'draw2' ? 2 : 4;
      const victimIdx = seatAfter(state, 1);
      const victim = state.seats[victimIdx];

      if (state.stacking) {
        // 累積起來丟給下家，由下家決定續疊或吞下
        state.pendingDraw += amount;
        state.turn = victimIdx;
        return { effect: 'draw', drawTargetId: victim.id, drawCount: state.pendingDraw };
      }

      victim.hand.push(...drawFromPile(state, amount, rng));
      state.turn = seatAfter(state, 2); // 抽完並跳過
      return { effect: 'draw', drawTargetId: victim.id, drawCount: amount };
    }
    default: {
      state.turn = seatAfter(state, 1);
      return { effect: 'none', drawTargetId: null, drawCount: 0 };
    }
  }
}

/** 吞下疊加的抽牌數，回合交給下一位 */
export function resolvePendingDraw(state: CoreState, rng: () => number = Math.random): { playerId: string; cards: Card[] } {
  const seat = state.seats[state.turn];
  const cards = drawFromPile(state, state.pendingDraw, rng);
  seat.hand.push(...cards);
  state.pendingDraw = 0;
  state.turn = seatAfter(state, 1);
  return { playerId: seat.id, cards };
}

/** 計分：數字牌照面值、功能牌 20 分、黑牌 50 分（越低越好） */
export function handPenalty(hand: Card[]): number {
  return hand.reduce((sum, c) => {
    if (c.kind === 'number') return sum + (c.value ?? 0);
    if (isWild(c)) return sum + 50;
    return sum + 20;
  }, 0);
}

/**
 * 開局：發牌後翻第一張作為起始棄牌。
 * 依規則起始牌不能是 wild4，遇到就洗回去重翻。
 */
export function flipStartCard(state: CoreState, rng: () => number = Math.random): Card {
  for (;;) {
    const [card] = drawFromPile(state, 1, rng);
    if (!card) throw new Error('牌堆已空，無法開局');
    if (card.kind === 'wild4') {
      state.drawPile.unshift(card); // 塞回底部再翻
      continue;
    }
    state.discardPile.push(card);
    state.activeColor = card.color ?? null;
    return card;
  }
}

/**
 * 起始牌若是功能牌，其效果對第一位玩家生效。
 * wild（非 wild4）依規則由第一位玩家選色 —— 這裡先隨機定色，
 * 讓開局不用多一次互動；伺服器可再覆寫。
 */
export function applyStartCard(state: CoreState, card: Card, rng: () => number = Math.random): void {
  switch (card.kind) {
    case 'skip':
      state.turn = seatAfter(state, 1);
      break;
    case 'reverse':
      state.direction = -1;
      state.turn = state.seats.length === 2 ? state.turn : (state.seats.length - 1);
      break;
    case 'draw2': {
      const victim = state.seats[state.turn];
      victim.hand.push(...drawFromPile(state, 2, rng));
      state.turn = seatAfter(state, 1);
      break;
    }
    case 'wild':
      state.activeColor = COLORS[Math.floor(rng() * COLORS.length)];
      break;
    default:
      break;
  }
}
