import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameFeedEvent, GameResult } from '@uno/shared';
import { GameEngine, UNO_BUFFER_MS, type EngineHooks, type PlayerMeta } from './game.ts';

/**
 * 可重現的偽亂數（mulberry32），讓測試不會偶爾紅一次。
 * 刻意不用簡單的 LCG —— 它連續取值會有相關性，會讓機率相關的測試失真。
 */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Harness {
  engine: GameEngine;
  feed: GameFeedEvent[];
  unoCalls: string[];
  catches: Array<{ catcher: string; caught: string }>;
  result: GameResult | null;
}

function makeGame(opts: {
  ids: string[];
  ai?: string[];
  seed?: number;
  stacking?: boolean;
}): Harness {
  const aiSet = new Set(opts.ai ?? []);
  const h: Harness = { engine: null as never, feed: [], unoCalls: [], catches: [], result: null };

  const hooks: EngineHooks = {
    metaOf: (id): PlayerMeta => ({
      nickname: id.toUpperCase(),
      avatar: 'robot',
      isAI: aiSet.has(id),
      connected: true,
      aiTakeover: false,
    }),
    emitState: () => {},
    feed: (e) => h.feed.push(e),
    unoCalled: (id) => h.unoCalls.push(id),
    unoCaught: (catcher, caught) => h.catches.push({ catcher, caught }),
    finished: (r) => { h.result = r; },
  };

  h.engine = new GameEngine(opts.ids, { stacking: opts.stacking ?? false }, hooks, seeded(opts.seed ?? 12345));
  return h;
}

/**
 * 讓指定玩家立刻進入「出一張就剩一張」的狀態。
 * 回傳那張保證出得掉的牌。
 */
function armUno(engine: GameEngine, playerId: string) {
  engine.state.turn = engine.state.seats.findIndex((s) => s.id === playerId);
  const seat = engine.state.seats[engine.state.turn];
  const playable =
    engine.state.drawPile.find((c) => c.kind === 'number' && c.color === engine.state.activeColor) ??
    engine.state.drawPile.find((c) => c.kind === 'wild')!;
  const spare = engine.state.drawPile.find((c) => c.id !== playable.id && c.kind === 'number')!;
  seat.hand = [playable, spare];
  return playable;
}

/** 把某位玩家的手牌換成指定內容（測 UNO 情境用） */
function setHand(engine: GameEngine, playerId: string, count: number) {
  const seat = engine.state.seats.find((s) => s.id === playerId)!;
  const extra = engine.state.drawPile.splice(0, Math.max(0, count - seat.hand.length));
  seat.hand = [...seat.hand, ...extra].slice(0, count);
}

describe('GameEngine 開局', () => {
  it('每人發七張，並翻出起始棄牌', () => {
    const { engine } = makeGame({ ids: ['a', 'b', 'c'] });
    for (const seat of engine.state.seats) {
      // 起始牌若是 +2，第一位玩家會多兩張
      expect(seat.hand.length).toBeGreaterThanOrEqual(7);
      expect(seat.hand.length).toBeLessThanOrEqual(9);
    }
    expect(engine.state.discardPile.length).toBe(1);
    expect(engine.state.activeColor).not.toBeNull();
  });

  it('viewFor 不會洩漏對手手牌', () => {
    const { engine } = makeGame({ ids: ['a', 'b', 'c'] });
    const view = engine.viewFor('a');
    expect(view.hand.length).toBeGreaterThan(0);
    expect(view.opponents).toHaveLength(2);
    for (const o of view.opponents) {
      expect(o.handCount).toBeGreaterThan(0);
      expect(o).not.toHaveProperty('hand');
    }
    expect(JSON.stringify(view.opponents)).not.toContain('"kind"');
  });

  it('對手依座位順序從自己的下一位開始排', () => {
    const { engine } = makeGame({ ids: ['a', 'b', 'c', 'd'] });
    expect(engine.viewFor('b').opponents.map((o) => o.id)).toEqual(['c', 'd', 'a']);
  });
});

describe('動作驗證', () => {
  it('不是自己的回合就不能出牌', () => {
    const { engine } = makeGame({ ids: ['a', 'b'] });
    const other = engine.state.seats.find((s) => s.id !== engine.viewFor('a').currentPlayerId)!;
    expect(engine.play(other.id, other.hand[0].id)).toBe('還沒輪到你');
  });

  it('不能出手上沒有的牌', () => {
    const { engine } = makeGame({ ids: ['a', 'b'] });
    const current = engine.viewFor('a').currentPlayerId;
    expect(engine.play(current, 'not-a-real-card')).toBe('你沒有這張牌');
  });

  it('沒抽牌就不能結束回合', () => {
    const { engine } = makeGame({ ids: ['a', 'b'] });
    const current = engine.viewFor('a').currentPlayerId;
    expect(engine.pass(current)).toBe('要先抽一張牌才能結束回合');
  });

  it('出黑牌一定要指定顏色', () => {
    const { engine } = makeGame({ ids: ['a', 'b'] });
    const current = engine.viewFor('a').currentPlayerId;
    const seat = engine.state.seats.find((s) => s.id === current)!;
    const wild = engine.state.drawPile.find((c) => c.kind === 'wild')!;
    seat.hand.push(wild);
    expect(engine.play(current, wild.id)).toBe('請先選擇顏色');
    expect(engine.play(current, wild.id, 'green')).toBeNull();
    expect(engine.state.activeColor).toBe('green');
  });
});

describe('UNO 緩衝與抓捕', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('出到剩一張會開啟 2 秒緩衝，期間別人不能抓', () => {
    const h = makeGame({ ids: ['a', 'b', 'c'] });
    const playable = armUno(h.engine, 'a');
    expect(h.engine.play('a', playable.id, 'red')).toBeNull();

    const view = h.engine.viewFor('a');
    expect(view.unoWindow?.playerId).toBe('a');
    expect(view.canCallUno).toBe(true);

    vi.advanceTimersByTime(500);
    expect(h.engine.catchUno('b', 'a')).toBe('緩衝時間內還不能抓');
    expect(h.catches).toHaveLength(0);
  });

  it('緩衝內喊 UNO 就安全，之後抓不到', () => {
    const h = makeGame({ ids: ['a', 'b', 'c'] });
    const playable = armUno(h.engine, 'a');
    h.engine.play('a', playable.id, 'red');

    vi.advanceTimersByTime(800);
    expect(h.engine.callUno('a')).toBeNull();
    expect(h.unoCalls).toEqual(['a']);

    vi.advanceTimersByTime(UNO_BUFFER_MS);
    expect(h.engine.catchUno('b', 'a')).toBe('現在抓不到他');
    expect(h.engine.viewFor('b').catchableIds).toEqual([]);
  });

  it('緩衝過了沒喊，別人抓到就罰抽兩張', () => {
    const h = makeGame({ ids: ['a', 'b', 'c'] });
    const playable = armUno(h.engine, 'a');
    h.engine.play('a', playable.id, 'red');

    vi.advanceTimersByTime(UNO_BUFFER_MS + 10);
    expect(h.engine.viewFor('b').catchableIds).toEqual(['a']);

    const before = h.engine.state.seats.find((s) => s.id === 'a')!.hand.length;
    expect(h.engine.catchUno('b', 'a')).toBeNull();

    const after = h.engine.state.seats.find((s) => s.id === 'a')!.hand.length;
    expect(after).toBe(before + 2);
    expect(h.catches).toEqual([{ catcher: 'b', caught: 'a' }]);
    expect(h.feed.some((e) => e.type === 'penalty' && e.reason === 'uno')).toBe(true);
  });

  it('緩衝過後本人補喊仍可自保', () => {
    const h = makeGame({ ids: ['a', 'b', 'c'] });
    const playable = armUno(h.engine, 'a');
    h.engine.play('a', playable.id, 'red');

    vi.advanceTimersByTime(UNO_BUFFER_MS + 10);
    expect(h.engine.callUno('a')).toBeNull();
    expect(h.engine.catchUno('b', 'a')).toBe('現在抓不到他');
  });

  it('同一個人不能被抓兩次', () => {
    const h = makeGame({ ids: ['a', 'b', 'c'] });
    const playable = armUno(h.engine, 'a');
    h.engine.play('a', playable.id, 'red');

    vi.advanceTimersByTime(UNO_BUFFER_MS + 10);
    expect(h.engine.catchUno('b', 'a')).toBeNull();
    expect(h.engine.catchUno('c', 'a')).toBe('現在抓不到他');
    expect(h.catches).toHaveLength(1);
  });

  it('不能抓自己', () => {
    const h = makeGame({ ids: ['a', 'b', 'c'] });
    const playable = armUno(h.engine, 'a');
    h.engine.play('a', playable.id, 'red');
    vi.advanceTimersByTime(UNO_BUFFER_MS + 10);
    expect(h.engine.catchUno('a', 'a')).toBe('不能抓自己');
  });

  it('抓捕視窗會在下一位玩家完成回合後關閉', () => {
    const h = makeGame({ ids: ['a', 'b', 'c'] });
    const playable = armUno(h.engine, 'a');
    h.engine.play('a', playable.id, 'red');
    vi.advanceTimersByTime(UNO_BUFFER_MS + 10);
    expect(h.engine.viewFor('c').catchableIds).toEqual(['a']);

    // b 抽一張並結束回合
    const current = h.engine.viewFor('b').currentPlayerId;
    h.engine.draw(current);
    if (h.engine.viewFor(current).isMyTurn) h.engine.pass(current);

    expect(h.engine.viewFor('c').catchableIds).toEqual([]);
    expect(h.engine.catchUno('c', 'a')).toBe('現在抓不到他');
  });

  it('手牌不再是一張時就抓不到了', () => {
    const h = makeGame({ ids: ['a', 'b', 'c'] });
    const playable = armUno(h.engine, 'a');
    h.engine.play('a', playable.id, 'red');
    vi.advanceTimersByTime(UNO_BUFFER_MS + 10);

    setHand(h.engine, 'a', 3);
    expect(h.engine.catchUno('b', 'a')).toBe('現在抓不到他');
  });

  it('沒有剩一張就不能喊 UNO', () => {
    const h = makeGame({ ids: ['a', 'b', 'c'] });
    expect(h.engine.callUno('a')).toBe('只有剩一張牌時才能喊 UNO');
  });
});

describe('AI 對局', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('四個 AI 能自己把一局打完並產生排名', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const h = makeGame({ ids, ai: ids, seed: 987 });

    // 推進足夠長的時間讓 AI 把牌打完
    for (let i = 0; i < 4000 && !h.result; i++) vi.advanceTimersByTime(200);

    expect(h.result).not.toBeNull();
    expect(h.result!.standings).toHaveLength(4);
    expect(h.result!.standings[0].rank).toBe(1);
    expect(h.result!.standings[0].playerId).toBe(h.result!.winnerId);
    expect(h.result!.standings[0].cardsLeft).toBe(0);
    expect(h.result!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('AI 剩一張時會在 2 秒緩衝內自己喊 UNO', () => {
    const h = makeGame({ ids: ['a', 'b', 'c'], ai: ['a'], seed: 4242 });
    const playable = armUno(h.engine, 'a');
    h.engine.play('a', playable.id, 'red');

    // AI 的喊聲排在緩衝內（300–1000ms），這裡推到緩衝結束前
    vi.advanceTimersByTime(UNO_BUFFER_MS - 100);
    expect(h.unoCalls).toContain('a');

    // 既然喊過了，緩衝結束後就不該變成可抓
    vi.advanceTimersByTime(200);
    expect(h.engine.viewFor('b').catchableIds).toEqual([]);
  });

  it('AI 會抓別人沒喊的 UNO', () => {
    // AI 抓捕是 70% 機率（刻意不是必抓），所以跑多個 seed 看整體行為，
    // 而不是賭某一個 seed —— 這樣測試才不會因為調整亂數而變得脆弱。
    let exposedRuns = 0; // 緩衝結束時 a 真的還剩一張、確實可被抓
    let caughtRuns = 0;

    for (let seed = 1; seed <= 30; seed++) {
      const h = makeGame({ ids: ['a', 'b', 'c', 'd'], ai: ['b', 'c', 'd'], seed });
      const playable = armUno(h.engine, 'a');
      h.engine.play('a', playable.id, 'red');

      // 緩衝這 2 秒內其他 AI 也在出牌，可能對 a 丟 +2／+4，
      // a 一旦不再是一張就沒東西好抓 —— 這些局要排除掉才測得準
      vi.advanceTimersByTime(UNO_BUFFER_MS + 10);
      if (h.engine.viewFor('b').catchableIds.length === 0) continue;
      exposedRuns += 1;

      vi.advanceTimersByTime(1500);
      if (h.catches.length > 0) {
        caughtRuns += 1;
        expect(h.catches[0].caught).toBe('a');
        expect(['b', 'c', 'd']).toContain(h.catches[0].catcher);
        expect(h.catches).toHaveLength(1); // 抓到一次就結束，不會被重複罰
      }
    }

    expect(exposedRuns).toBeGreaterThan(5);
    // 三個 AI 各有 70% 機率會出手，實際暴露的局幾乎都該被抓到
    expect(caughtRuns).toBeGreaterThan(exposedRuns * 0.8);
  });
});

describe('中途離場', () => {
  it('剩最後一人時直接結束', () => {
    const h = makeGame({ ids: ['a', 'b', 'c'] });
    h.engine.removeSeat('b');
    expect(h.result).toBeNull();
    h.engine.removeSeat('c');
    expect(h.result?.winnerId).toBe('a');
  });

  it('離場者的牌會回到抽牌堆', () => {
    const h = makeGame({ ids: ['a', 'b', 'c'] });
    const before = h.engine.state.drawPile.length;
    const handSize = h.engine.state.seats.find((s) => s.id === 'c')!.hand.length;
    h.engine.removeSeat('c');
    expect(h.engine.state.drawPile.length).toBe(before + handSize);
    expect(h.engine.state.seats).toHaveLength(2);
  });
});
