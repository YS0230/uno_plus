/**
 * 普通難度 AI —— 純函式決策，規則判斷全部沿用 shared/rules。
 *
 * 策略重點：
 *   1. 下家快贏了就打功能牌卡他
 *   2. 平時先出數字牌（丟掉大分），功能牌留著當工具
 *   3. 黑牌最後才出，選色選手上最多的顏色
 */
import {
  COLORS,
  canPlay,
  isWild,
  playableCards,
  topCard,
  type Card,
  type CardColor,
  type CoreState,
} from '@uno/shared';

export type AIMove =
  | { type: 'play'; cardId: string; chosenColor?: CardColor }
  | { type: 'draw' };

/** 出牌優先度，數字越大越優先 */
function scoreCard(card: Card, threatened: boolean): number {
  switch (card.kind) {
    case 'wild4':
      return threatened ? 100 : 5; // 平時捨不得，對手快贏時毫不猶豫
    case 'draw2':
      return threatened ? 90 : 45;
    case 'skip':
      return threatened ? 80 : 40;
    case 'reverse':
      return threatened ? 70 : 38;
    case 'wild':
      return 10; // 保留彈性，盡量最後出
    default:
      return 50 + (card.value ?? 0); // 數字牌優先，且先丟大的
  }
}

/** 手上最多的顏色；沒有彩色牌就隨便挑一色 */
export function chooseColor(hand: Card[], rng: () => number = Math.random): CardColor {
  const tally: Record<CardColor, number> = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const c of hand) if (c.color) tally[c.color] += 1;

  let best: CardColor[] = [];
  let max = -1;
  for (const color of COLORS) {
    if (tally[color] > max) { max = tally[color]; best = [color]; }
    else if (tally[color] === max) best.push(color);
  }
  return best[Math.floor(rng() * best.length)];
}

/**
 * 決定這一手要怎麼走。
 * 回傳 draw 表示抽牌 —— 上層抽完後會再問一次，屆時若抽到能出的牌就會出掉。
 */
export function decideMove(
  state: CoreState,
  seatIndex: number,
  opts: { alreadyDrew: boolean; rng?: () => number } = { alreadyDrew: false },
): AIMove | { type: 'pass' } {
  const rng = opts.rng ?? Math.random;
  const seat = state.seats[seatIndex];
  const top = topCard(state);

  const options = playableCards(seat.hand, top, state.activeColor, state.pendingDraw);

  if (options.length === 0) {
    // 疊加中無牌可疊，或這回合已經抽過還是出不了 —— 都只能吞下／結束回合
    return opts.alreadyDrew ? { type: 'pass' } : { type: 'draw' };
  }

  // 下家只剩 1–2 張就視為威脅
  const n = state.seats.length;
  const nextSeat = state.seats[(((seatIndex + state.direction) % n) + n) % n];
  const threatened = nextSeat.hand.length <= 2;

  const best = [...options].sort((a, b) => scoreCard(b, threatened) - scoreCard(a, threatened))[0];

  return isWild(best)
    ? { type: 'play', cardId: best.id, chosenColor: chooseColor(seat.hand.filter((c) => c.id !== best.id), rng) }
    : { type: 'play', cardId: best.id };
}

/** 剛抽到的牌能不能立刻打出去 */
export function canPlayDrawn(state: CoreState, card: Card): boolean {
  return canPlay(card, topCard(state), state.activeColor, state.pendingDraw);
}

/** AI 抓 UNO 的機率 —— 故意不是 100%，讓它有點人味 */
export const AI_CATCH_CHANCE = 0.7;

/**
 * AI 思考時間，避免它出牌快到看不清楚。
 * 測試時用環境變數調到近乎 0，免得端對端測試要等一整局的真實時間。
 */
const THINK_BASE_MS = Number(process.env.UNO_AI_DELAY_MS ?? 700);
const THINK_JITTER_MS = Number(process.env.UNO_AI_JITTER_MS ?? 900);

export const aiThinkDelay = (rng: () => number = Math.random): number =>
  THINK_BASE_MS + Math.floor(rng() * THINK_JITTER_MS);
