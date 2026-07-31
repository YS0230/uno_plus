/**
 * 權威對局狀態機。所有規則判斷都在伺服器做，前端送來的只是「意圖」。
 *
 * 兩個關鍵設計：
 *   1. 視角裁切 —— 廣播前對每位玩家生成 GameView，對手手牌只給張數
 *   2. UNO 緩衝與抓捕由伺服器計時，前端拿到的是絕對時間戳自行倒數
 */
import {
  applyEffect,
  applyStartCard,
  buildDeck,
  describeCard,
  drawFromPile,
  flipStartCard,
  handPenalty,
  isWild,
  playableCards,
  resolvePendingDraw,
  seatAfter,
  shuffle,
  topCard,
  type AvatarId,
  type CardColor,
  type CoreState,
  type GameFeedEvent,
  type GameResult,
  type GameView,
  type OpponentView,
  type Standing,
} from '@uno/shared';
import { AI_CATCH_CHANCE, aiThinkDelay, canPlayDrawn, decideMove } from './ai.ts';

/** 出牌後只有出牌者能喊 UNO 的獨佔時間 */
export const UNO_BUFFER_MS = 2000;
/** 回合逾時：自動抽一張並結束回合 */
export const TURN_TIMEOUT_MS = 30_000;
const HAND_SIZE = 7;

export interface PlayerMeta {
  nickname: string;
  avatar: AvatarId;
  isAI: boolean;
  connected: boolean;
  aiTakeover: boolean;
}

export interface EngineHooks {
  metaOf(playerId: string): PlayerMeta;
  emitState(): void;
  feed(event: GameFeedEvent): void;
  unoCalled(playerId: string): void;
  unoCaught(catcherId: string, caughtId: string): void;
  finished(result: GameResult): void;
}

export class GameEngine {
  readonly state: CoreState;
  readonly startedAt = Date.now();

  private phase: 'playing' | 'finished' = 'playing';
  private hasDrawnThisTurn = false;
  private turnCounter = 0;
  private turnDeadline: number | null = null;

  /** 已在緩衝內喊過 UNO 的玩家 */
  private saidUno = new Set<string>();
  /** playerId → 這筆抓捕機會在 turnCounter 超過這個值之後失效 */
  private catchable = new Map<string, number>();
  /** 進行中的緩衝倒數：只有 playerId 本人能喊 */
  private unoWindow: { playerId: string; deadline: number } | null = null;

  private timers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;

  constructor(
    playerIds: string[],
    options: { stacking: boolean },
    private hooks: EngineHooks,
    private rng: () => number = Math.random,
  ) {
    const deck = shuffle(buildDeck(), rng);
    this.state = {
      seats: playerIds.map((id) => ({ id, hand: [] })),
      turn: 0,
      direction: 1,
      drawPile: deck,
      discardPile: [],
      activeColor: null,
      pendingDraw: 0,
      stacking: options.stacking,
    };

    for (let i = 0; i < HAND_SIZE; i++) {
      for (const seat of this.state.seats) seat.hand.push(...drawFromPile(this.state, 1, rng));
    }

    const start = flipStartCard(this.state, rng);
    applyStartCard(this.state, start, rng);

    this.beginTurn();
  }

  // ------------------------------------------------------------- 生命週期

  dispose(): void {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.disposed && this.phase === 'playing') fn();
    }, ms);
    this.timers.add(t);
  }

  private get current() {
    return this.state.seats[this.state.turn];
  }

  private seatOf(playerId: string) {
    return this.state.seats.find((s) => s.id === playerId) ?? null;
  }

  private name(playerId: string): string {
    return this.hooks.metaOf(playerId).nickname;
  }

  private isBot(playerId: string): boolean {
    const m = this.hooks.metaOf(playerId);
    return m.isAI || m.aiTakeover;
  }

  // ------------------------------------------------------------ 回合推進

  /** 回合切換後的共同收尾：清逾時、過期的抓捕機會、排 AI 行動 */
  private beginTurn(): void {
    this.hasDrawnThisTurn = false;
    this.turnDeadline = Date.now() + TURN_TIMEOUT_MS;

    for (const [id, expiresAt] of this.catchable) {
      if (expiresAt < this.turnCounter) this.catchable.delete(id);
    }

    const turnAtSchedule = this.turnCounter;
    this.later(TURN_TIMEOUT_MS, () => {
      if (this.turnCounter === turnAtSchedule) this.onTurnTimeout();
    });

    if (this.isBot(this.current.id)) {
      this.later(aiThinkDelay(this.rng), () => {
        if (this.turnCounter === turnAtSchedule) this.runAI();
      });
    }
  }

  /**
   * 確認交棒。state.turn 必須已經指向新的當前玩家 —— 出牌時是 applyEffect 移的，
   * 其他情況要先呼叫 endTurn()。turnCounter 是抓捕視窗與逾時計時的依據。
   */
  private commitTurn(): void {
    this.turnCounter += 1;
    this.beginTurn();
  }

  /** 把回合交給下一位（抽到不能出的牌、結束回合、逾時等） */
  private endTurn(): void {
    this.state.turn = seatAfter(this.state, 1);
    this.commitTurn();
  }

  private onTurnTimeout(): void {
    const seat = this.current;
    if (this.state.pendingDraw > 0) {
      this.resolveStack();
      this.hooks.emitState();
      return;
    }
    const drawn = drawFromPile(this.state, 1, this.rng);
    seat.hand.push(...drawn);
    this.hooks.feed({ type: 'penalty', playerId: seat.id, nickname: this.name(seat.id), count: drawn.length, reason: 'timeout' });
    this.syncUnoFlags(seat.id);
    this.endTurn();
    this.hooks.emitState();
  }

  // ------------------------------------------------------------ 玩家動作

  /** @returns 錯誤訊息，成功則回 null */
  play(playerId: string, cardId: string, chosenColor?: CardColor): string | null {
    if (this.phase !== 'playing') return '遊戲已結束';
    if (this.current.id !== playerId) return '還沒輪到你';

    const seat = this.current;
    const index = seat.hand.findIndex((c) => c.id === cardId);
    if (index === -1) return '你沒有這張牌';

    const card = seat.hand[index];
    const top = topCard(this.state);
    if (!playableCards([card], top, this.state.activeColor, this.state.pendingDraw).length) {
      return '這張牌現在不能出';
    }
    if (isWild(card) && !chosenColor) return '請先選擇顏色';

    seat.hand.splice(index, 1);
    this.state.discardPile.push(card);
    this.state.activeColor = isWild(card) ? chosenColor! : card.color;

    this.hooks.feed({
      type: 'played',
      playerId,
      nickname: this.name(playerId),
      cardLabel: describeCard(card),
      color: this.state.activeColor,
    });
    if (isWild(card)) {
      this.hooks.feed({ type: 'color', playerId, nickname: this.name(playerId), color: chosenColor! });
    }

    // 出光了就直接結束，不需要喊 UNO
    if (seat.hand.length === 0) {
      this.finish(playerId);
      return null;
    }

    const before = this.state.direction;
    const outcome = applyEffect(this.state, card, this.rng);
    if (outcome.effect === 'reverse' && this.state.direction !== before) {
      this.hooks.feed({ type: 'reversed', direction: this.state.direction });
    }
    if (outcome.effect === 'skip') {
      const skipped = this.state.seats[seatAfter(this.state, -1)];
      this.hooks.feed({ type: 'skipped', playerId: skipped.id, nickname: this.name(skipped.id) });
    }
    if (outcome.effect === 'draw' && outcome.drawTargetId && !this.state.stacking) {
      this.hooks.feed({
        type: 'drew',
        playerId: outcome.drawTargetId,
        nickname: this.name(outcome.drawTargetId),
        count: outcome.drawCount,
      });
      this.syncUnoFlags(outcome.drawTargetId);
    }

    // 剩最後一張 → 開 2 秒獨佔緩衝
    if (seat.hand.length === 1) this.openUnoWindow(playerId);
    else this.clearUnoFor(playerId);

    this.commitTurn(); // applyEffect 已經移好 state.turn
    this.hooks.emitState();
    return null;
  }

  draw(playerId: string): string | null {
    if (this.phase !== 'playing') return '遊戲已結束';
    if (this.current.id !== playerId) return '還沒輪到你';

    if (this.state.pendingDraw > 0) {
      this.resolveStack();
      this.hooks.emitState();
      return null;
    }
    if (this.hasDrawnThisTurn) return '這回合已經抽過牌了';

    const seat = this.current;
    const drawn = drawFromPile(this.state, 1, this.rng);
    seat.hand.push(...drawn);
    this.hasDrawnThisTurn = true;
    this.hooks.feed({ type: 'drew', playerId, nickname: this.name(playerId), count: drawn.length });
    this.syncUnoFlags(playerId);

    // 抽到不能出的牌就直接結束回合，省一次無意義的點擊
    const playable = drawn.length > 0 && canPlayDrawn(this.state, drawn[0]);
    if (!playable) {
      this.endTurn();
    } else if (this.isBot(playerId)) {
      this.later(aiThinkDelay(this.rng), () => this.runAI());
    }

    this.hooks.emitState();
    return null;
  }

  pass(playerId: string): string | null {
    if (this.phase !== 'playing') return '遊戲已結束';
    if (this.current.id !== playerId) return '還沒輪到你';
    if (!this.hasDrawnThisTurn) return '要先抽一張牌才能結束回合';

    this.endTurn();
    this.hooks.emitState();
    return null;
  }

  /** 吞下疊加的抽牌數 */
  private resolveStack(): void {
    const { playerId, cards } = resolvePendingDraw(this.state, this.rng); // 內部已交棒
    this.hooks.feed({ type: 'drew', playerId, nickname: this.name(playerId), count: cards.length });
    this.syncUnoFlags(playerId);
    this.commitTurn();
  }

  // ---------------------------------------------------------------- UNO

  private openUnoWindow(playerId: string): void {
    this.saidUno.delete(playerId);
    this.catchable.delete(playerId);
    this.unoWindow = { playerId, deadline: Date.now() + UNO_BUFFER_MS };

    // AI 一定會在緩衝內喊
    if (this.isBot(playerId)) {
      this.later(300 + Math.floor(this.rng() * 700), () => this.callUno(playerId));
    }

    this.later(UNO_BUFFER_MS, () => {
      if (this.unoWindow?.playerId !== playerId) return;
      this.unoWindow = null;
      const seat = this.seatOf(playerId);
      if (!seat || seat.hand.length !== 1 || this.saidUno.has(playerId)) {
        this.hooks.emitState();
        return;
      }
      // 緩衝過了還沒喊 —— 開放其他人抓
      this.catchable.set(playerId, this.turnCounter);
      this.hooks.emitState();
      this.scheduleAICatch(playerId);
    });
  }

  /**
   * 喊 UNO。
   * 緩衝內只有本人能喊；緩衝過後本人仍可補喊來自保 —— 這時就是他跟其他玩家搶時間。
   */
  callUno(playerId: string): string | null {
    if (this.phase !== 'playing') return '遊戲已結束';
    const seat = this.seatOf(playerId);
    if (!seat) return '你不在這場遊戲裡';
    if (seat.hand.length !== 1) return '只有剩一張牌時才能喊 UNO';
    if (this.saidUno.has(playerId)) return null;

    const inBuffer = this.unoWindow?.playerId === playerId;
    const inRace = this.catchable.has(playerId);
    if (!inBuffer && !inRace) return '現在不能喊 UNO';

    this.saidUno.add(playerId);
    this.catchable.delete(playerId);
    if (inBuffer) this.unoWindow = null;

    this.hooks.unoCalled(playerId);
    this.hooks.emitState();
    return null;
  }

  /**
   * 抓 UNO。緩衝時間內一律拒絕 —— 規格要求其他玩家不可搶先舉報。
   */
  catchUno(catcherId: string, targetId: string): string | null {
    if (this.phase !== 'playing') return '遊戲已結束';
    if (catcherId === targetId) return '不能抓自己';
    if (!this.seatOf(catcherId)) return '你不在這場遊戲裡';

    if (this.unoWindow?.playerId === targetId && Date.now() < this.unoWindow.deadline) {
      return '緩衝時間內還不能抓';
    }
    if (!this.catchable.has(targetId)) return '現在抓不到他';

    const target = this.seatOf(targetId);
    if (!target || target.hand.length !== 1) {
      this.catchable.delete(targetId);
      return '現在抓不到他';
    }

    this.catchable.delete(targetId);
    const penalty = drawFromPile(this.state, 2, this.rng);
    target.hand.push(...penalty);

    this.hooks.unoCaught(catcherId, targetId);
    this.hooks.feed({
      type: 'penalty',
      playerId: targetId,
      nickname: this.name(targetId),
      count: penalty.length,
      reason: 'uno',
    });
    this.hooks.emitState();
    return null;
  }

  /** 手牌張數變了就重算 UNO 相關旗標 */
  private syncUnoFlags(playerId: string): void {
    const seat = this.seatOf(playerId);
    if (!seat || seat.hand.length !== 1) this.clearUnoFor(playerId);
  }

  private clearUnoFor(playerId: string): void {
    this.saidUno.delete(playerId);
    this.catchable.delete(playerId);
    if (this.unoWindow?.playerId === playerId) this.unoWindow = null;
  }

  private scheduleAICatch(targetId: string): void {
    for (const seat of this.state.seats) {
      if (seat.id === targetId || !this.isBot(seat.id)) continue;
      if (this.rng() > AI_CATCH_CHANCE) continue;
      this.later(400 + Math.floor(this.rng() * 900), () => {
        if (this.catchable.has(targetId)) this.catchUno(seat.id, targetId);
      });
    }
  }

  // ----------------------------------------------------------------- AI

  private runAI(): void {
    const seat = this.current;
    if (!this.isBot(seat.id)) return;

    const move = decideMove(this.state, this.state.turn, { alreadyDrew: this.hasDrawnThisTurn, rng: this.rng });
    if (move.type === 'play') this.play(seat.id, move.cardId, move.chosenColor);
    else if (move.type === 'draw') this.draw(seat.id);
    else this.pass(seat.id);
  }

  /** 真人離線改由 AI 接手時，若正好輪到他就立刻續上 */
  nudgeAI(): void {
    if (this.phase !== 'playing') return;
    if (!this.isBot(this.current.id)) return;
    const turnAtSchedule = this.turnCounter;
    this.later(aiThinkDelay(this.rng), () => {
      if (this.turnCounter === turnAtSchedule) this.runAI();
    });
  }

  // -------------------------------------------------------------- 結算

  private finish(winnerId: string): void {
    this.phase = 'finished';
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();

    const ranked = [...this.state.seats].sort((a, b) => {
      if (a.id === winnerId) return -1;
      if (b.id === winnerId) return 1;
      return handPenalty(a.hand) - handPenalty(b.hand) || a.hand.length - b.hand.length;
    });

    const standings: Standing[] = ranked.map((seat, i) => {
      const meta = this.hooks.metaOf(seat.id);
      return {
        playerId: seat.id,
        nickname: meta.nickname,
        avatar: meta.avatar,
        isAI: meta.isAI || meta.aiTakeover,
        rank: i + 1,
        cardsLeft: seat.hand.length,
        penalty: handPenalty(seat.hand),
      };
    });

    this.hooks.emitState();
    this.hooks.finished({
      winnerId,
      winnerNickname: this.name(winnerId),
      standings,
      durationMs: Date.now() - this.startedAt,
    });
  }

  // ------------------------------------------------------------ 視角裁切

  /** 產生指定玩家看得到的狀態。對手手牌只給張數，避免前端能偷看。 */
  viewFor(playerId: string): GameView {
    const myIndex = this.state.seats.findIndex((s) => s.id === playerId);
    const seat = myIndex >= 0 ? this.state.seats[myIndex] : null;
    const hand = seat ? seat.hand : [];
    const top = topCard(this.state);

    // 從自己的下一位開始，前端才好環繞排版
    const order: number[] = [];
    const n = this.state.seats.length;
    const base = myIndex >= 0 ? myIndex : 0;
    for (let i = 1; i < n; i++) order.push((base + i) % n);

    const opponents: OpponentView[] = order.map((idx) => {
      const s = this.state.seats[idx];
      const meta = this.hooks.metaOf(s.id);
      return {
        id: s.id,
        nickname: meta.nickname,
        avatar: meta.avatar,
        isAI: meta.isAI,
        connected: meta.connected,
        aiTakeover: meta.aiTakeover,
        handCount: s.hand.length,
        saidUno: this.saidUno.has(s.id),
        catchable: this.catchable.has(s.id),
      };
    });

    const isMyTurn = seat !== null && this.current.id === playerId && this.phase === 'playing';
    const playable = isMyTurn
      ? playableCards(hand, top, this.state.activeColor, this.state.pendingDraw).map((c) => c.id)
      : [];

    return {
      phase: this.phase,
      opponents,
      hand,
      playableIds: playable,
      discardTop: top,
      activeColor: this.state.activeColor,
      drawPileCount: this.state.drawPile.length,
      discardPileCount: this.state.discardPile.length,
      currentPlayerId: this.current.id,
      nextPlayerId: this.state.seats[seatAfter(this.state, 1)].id,
      direction: this.state.direction,
      isMyTurn,
      hasDrawnThisTurn: isMyTurn && this.hasDrawnThisTurn,
      pendingDraw: this.state.pendingDraw,
      unoWindow: this.unoWindow,
      canCallUno:
        hand.length === 1 &&
        !this.saidUno.has(playerId) &&
        (this.unoWindow?.playerId === playerId || this.catchable.has(playerId)),
      catchableIds: [...this.catchable.keys()].filter((id) => id !== playerId),
      turnDeadline: this.turnDeadline,
      startedAt: this.startedAt,
    };
  }

  get isFinished(): boolean {
    return this.phase === 'finished';
  }

  /** 中途有人離開，把他的牌收回牌堆並移出座位 */
  removeSeat(playerId: string): void {
    const idx = this.state.seats.findIndex((s) => s.id === playerId);
    if (idx === -1) return;

    const [seat] = this.state.seats.splice(idx, 1);
    this.state.drawPile.push(...seat.hand);
    this.clearUnoFor(playerId);

    if (this.state.seats.length < 2) {
      const survivor = this.state.seats[0];
      if (survivor) this.finish(survivor.id);
      return;
    }
    // splice 之後索引會往前移，只有「離開者排在當前玩家之前」才需要補正
    if (idx < this.state.turn) this.state.turn -= 1;
    this.state.turn = ((this.state.turn % this.state.seats.length) + this.state.seats.length) % this.state.seats.length;
    this.commitTurn();
  }
}
