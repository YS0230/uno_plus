import { describe, expect, it } from 'vitest';
import { buildDeck, COLORS, type Card, type CardColor } from './cards.ts';
import {
  applyEffect,
  canPlay,
  drawFromPile,
  flipStartCard,
  handPenalty,
  playableCards,
  resolvePendingDraw,
  seatAfter,
  type CoreState,
} from './rules.ts';

const card = (color: CardColor | null, kind: Card['kind'], value?: number): Card =>
  value === undefined ? { id: `${color}-${kind}`, color, kind } : { id: `${color}-${kind}-${value}`, color, kind, value };

function makeState(seatCount: number, over: Partial<CoreState> = {}): CoreState {
  return {
    seats: Array.from({ length: seatCount }, (_, i) => ({ id: `p${i}`, hand: [] })),
    turn: 0,
    direction: 1,
    drawPile: [],
    discardPile: [],
    activeColor: null,
    pendingDraw: 0,
    stacking: false,
    ...over,
  };
}

describe('buildDeck', () => {
  const deck = buildDeck();

  it('是 108 張', () => {
    expect(deck).toHaveLength(108);
  });

  it('每色 0 一張、1–9 各兩張', () => {
    for (const color of COLORS) {
      const nums = deck.filter((c) => c.color === color && c.kind === 'number');
      expect(nums.filter((c) => c.value === 0)).toHaveLength(1);
      for (let v = 1; v <= 9; v++) {
        expect(nums.filter((c) => c.value === v)).toHaveLength(2);
      }
    }
  });

  it('功能牌每色兩張，黑牌各四張', () => {
    for (const color of COLORS) {
      for (const kind of ['skip', 'reverse', 'draw2'] as const) {
        expect(deck.filter((c) => c.color === color && c.kind === kind)).toHaveLength(2);
      }
    }
    expect(deck.filter((c) => c.kind === 'wild')).toHaveLength(4);
    expect(deck.filter((c) => c.kind === 'wild4')).toHaveLength(4);
  });

  it('每張 id 唯一', () => {
    expect(new Set(deck.map((c) => c.id)).size).toBe(108);
  });
});

describe('canPlay', () => {
  const top = card('red', 'number', 5);

  it('同色可出', () => {
    expect(canPlay(card('red', 'number', 9), top, 'red')).toBe(true);
  });

  it('同數字跨色可出', () => {
    expect(canPlay(card('blue', 'number', 5), top, 'red')).toBe(true);
  });

  it('不同色不同數字不可出', () => {
    expect(canPlay(card('blue', 'number', 9), top, 'red')).toBe(false);
  });

  it('黑牌隨時可出', () => {
    expect(canPlay(card(null, 'wild'), top, 'red')).toBe(true);
    expect(canPlay(card(null, 'wild4'), top, 'red')).toBe(true);
  });

  it('同功能跨色可出', () => {
    expect(canPlay(card('green', 'skip'), card('blue', 'skip'), 'blue')).toBe(true);
  });

  it('看 activeColor 而不是頂牌顏色（頂牌是黑牌時）', () => {
    const wildTop = card(null, 'wild');
    expect(canPlay(card('green', 'number', 3), wildTop, 'green')).toBe(true);
    expect(canPlay(card('red', 'number', 3), wildTop, 'green')).toBe(false);
  });

  it('疊加中：+2 上只能疊 +2 或 +4', () => {
    const d2 = card('red', 'draw2');
    expect(canPlay(card('blue', 'draw2'), d2, 'red', 2)).toBe(true);
    expect(canPlay(card(null, 'wild4'), d2, 'red', 2)).toBe(true);
    expect(canPlay(card('red', 'number', 5), d2, 'red', 2)).toBe(false);
    expect(canPlay(card(null, 'wild'), d2, 'red', 2)).toBe(false);
  });

  it('疊加中：+4 上只能疊 +4', () => {
    const w4 = card(null, 'wild4');
    expect(canPlay(card(null, 'wild4'), w4, 'red', 4)).toBe(true);
    expect(canPlay(card('red', 'draw2'), w4, 'red', 4)).toBe(false);
  });
});

describe('playableCards', () => {
  it('只挑得出可出的牌', () => {
    const hand = [
      card('red', 'number', 1),
      card('blue', 'number', 7),
      card(null, 'wild'),
      card('green', 'skip'),
    ];
    const ids = playableCards(hand, card('red', 'number', 3), 'red').map((c) => c.id);
    expect(ids).toEqual(['red-number-1', 'null-wild']);
  });
});

describe('turn order', () => {
  it('順向前進', () => {
    const s = makeState(4);
    expect(seatAfter(s, 1)).toBe(1);
    expect(seatAfter(s, 2)).toBe(2);
  });

  it('逆向會繞回去', () => {
    const s = makeState(4, { turn: 0, direction: -1 });
    expect(seatAfter(s, 1)).toBe(3);
  });
});

describe('applyEffect', () => {
  it('skip 跳過下一位', () => {
    const s = makeState(4);
    applyEffect(s, card('red', 'skip'));
    expect(s.turn).toBe(2);
  });

  it('reverse 反轉方向並交棒', () => {
    const s = makeState(4, { turn: 1 });
    applyEffect(s, card('red', 'reverse'));
    expect(s.direction).toBe(-1);
    expect(s.turn).toBe(0);
  });

  it('兩人時 reverse 等同 skip —— 回合留在自己', () => {
    const s = makeState(2, { turn: 0 });
    applyEffect(s, card('red', 'reverse'));
    expect(s.direction).toBe(-1);
    expect(s.turn).toBe(0);
  });

  it('+2 讓下家抽兩張並跳過（未開疊加）', () => {
    const s = makeState(3, { drawPile: buildDeck().slice(0, 10) });
    const out = applyEffect(s, card('red', 'draw2'));
    expect(s.seats[1].hand).toHaveLength(2);
    expect(s.turn).toBe(2);
    expect(out).toMatchObject({ effect: 'draw', drawTargetId: 'p1', drawCount: 2 });
  });

  it('+4 讓下家抽四張並跳過（未開疊加）', () => {
    const s = makeState(3, { drawPile: buildDeck().slice(0, 10) });
    applyEffect(s, card(null, 'wild4'));
    expect(s.seats[1].hand).toHaveLength(4);
    expect(s.turn).toBe(2);
  });

  it('開啟疊加時 +2 只累積，不立刻抽，且回合交給下家', () => {
    const s = makeState(3, { stacking: true, drawPile: buildDeck().slice(0, 10) });
    applyEffect(s, card('red', 'draw2'));
    expect(s.pendingDraw).toBe(2);
    expect(s.seats[1].hand).toHaveLength(0);
    expect(s.turn).toBe(1);

    applyEffect(s, card('blue', 'draw2')); // 下家再疊一張
    expect(s.pendingDraw).toBe(4);
    expect(s.turn).toBe(2);
  });

  it('吞下疊加後回合往下走', () => {
    const s = makeState(3, { stacking: true, turn: 2, pendingDraw: 6, drawPile: buildDeck().slice(0, 10) });
    const res = resolvePendingDraw(s);
    expect(res.playerId).toBe('p2');
    expect(s.seats[2].hand).toHaveLength(6);
    expect(s.pendingDraw).toBe(0);
    expect(s.turn).toBe(0);
  });
});

describe('drawFromPile', () => {
  it('抽牌堆空時把棄牌堆（保留頂張）洗回來', () => {
    const used = buildDeck().slice(0, 8);
    const topId = used[used.length - 1].id;
    const s = makeState(2, { drawPile: [], discardPile: [...used] });
    const drawn = drawFromPile(s, 3);

    expect(drawn).toHaveLength(3);
    expect(s.discardPile).toHaveLength(1); // 只剩原本的頂張
    expect(s.discardPile[0].id).toBe(topId);
    expect(s.drawPile).toHaveLength(4); // 7 張洗回、抽掉 3 張
  });

  it('連棄牌堆都沒得洗時，有幾張給幾張', () => {
    const s = makeState(2, { drawPile: [], discardPile: [card('red', 'number', 1)] });
    expect(drawFromPile(s, 5)).toHaveLength(0);
  });
});

describe('flipStartCard', () => {
  it('起始牌不會是 +4', () => {
    const w4 = card(null, 'wild4');
    const s = makeState(2, { drawPile: [card('blue', 'number', 3), w4] }); // pop 先拿到 w4
    const start = flipStartCard(s);
    expect(start.kind).not.toBe('wild4');
    expect(s.activeColor).toBe('blue');
  });
});

describe('handPenalty', () => {
  it('數字照面值、功能牌 20、黑牌 50', () => {
    expect(handPenalty([card('red', 'number', 7), card('blue', 'skip'), card(null, 'wild4')])).toBe(77);
  });

  it('空手為 0', () => {
    expect(handPenalty([])).toBe(0);
  });
});
