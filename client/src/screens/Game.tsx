import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { COLORS, type Card, type CardColor, type OpponentView } from '@uno/shared';
import { UnoCard } from '../components/UnoCard.tsx';
import { Avatar, Badge, Button, Icon } from '../components/ui.tsx';
import { COLOR_LABEL, CARD_PALETTE } from '../theme.ts';
import { EMOTES, QUICK_MESSAGES } from '../features/Chat.tsx';
import { SoundToggles } from './Home.tsx';
import { actions, useStore } from '../store.ts';
import { UNO_BUFFER_MS, useCountdown } from '../features/timing.ts';
import './Game.css';

/** 對手在桌邊的位置：opponents[0] 是下一位出牌的人 */
const SEAT_SLOTS: Record<number, string[]> = {
  1: ['top'],
  2: ['left', 'right'],
  3: ['left', 'top', 'right'],
};

export function Game() {
  const game = useStore((s) => s.game);
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.profile?.playerId);
  const [pendingWild, setPendingWild] = useState<Card | null>(null);
  const [trayOpen, setTrayOpen] = useState<'none' | 'emote' | 'quick'>('none');

  // 出牌過場：牌先在畫面中央亮相，再飛進棄牌堆
  const discardRef = useRef<HTMLDivElement>(null);
  const flight = usePlayFlight(game?.discardTop ?? null);

  if (!game || !room) return null;

  const slots = SEAT_SLOTS[game.opponents.length] ?? ['top'];
  const playable = new Set(game.playableIds);

  const playCard = (card: Card) => {
    actions.click();
    if (!game.isMyTurn || !playable.has(card.id)) return;
    if (card.color === null) setPendingWild(card);
    else void actions.playCard(card.id);
  };

  const chooseColor = (color: CardColor) => {
    if (!pendingWild) return;
    void actions.playCard(pendingWild.id, color);
    setPendingWild(null);
  };

  return (
    <div className={`game game--felt-${room.options.felt}`}>
      <GameTopBar />
      <TurnBar />

      <div className="table">
        <div className="table__felt" />

        {game.opponents.map((opponent, i) => (
          <OpponentSeat
            key={opponent.id}
            opponent={opponent}
            slot={slots[i] ?? 'top'}
            isCurrent={game.currentPlayerId === opponent.id}
            canCatch={game.catchableIds.includes(opponent.id)}
          />
        ))}

        <TableCenter discardRef={discardRef} topOverride={flight?.prev ?? null} />
      </div>

      <MyHand playable={playable} onPlay={playCard} showStatus={!!me} />

      {flight && (
        <PlayFlight
          key={flight.seq}
          card={flight.card}
          targetRef={discardRef}
          onDone={flight.done}
        />
      )}

      <div className="game__tools">
        <button
          type="button"
          className={`game__tool ${trayOpen === 'emote' ? 'is-on' : ''}`}
          onClick={() => { actions.click(); setTrayOpen(trayOpen === 'emote' ? 'none' : 'emote'); }}
          aria-label="表情"
        >
          😀
        </button>
        <button
          type="button"
          className={`game__tool ${trayOpen === 'quick' ? 'is-on' : ''}`}
          onClick={() => { actions.click(); setTrayOpen(trayOpen === 'quick' ? 'none' : 'quick'); }}
          aria-label="快速訊息"
        >
          <Icon name="chat" size={22} />
        </button>
      </div>

      {trayOpen !== 'none' && (
        <div className="game__tray">
          {(trayOpen === 'emote' ? EMOTES : QUICK_MESSAGES).map((item) => (
            <button
              key={item}
              type="button"
              className={trayOpen === 'emote' ? 'game__tray-emote' : 'game__tray-quick'}
              onClick={() => {
                actions.click();
                void (trayOpen === 'emote' ? actions.sendEmote(item) : actions.sendChat(item));
                setTrayOpen('none');
              }}
            >
              {item}
            </button>
          ))}
        </div>
      )}

      <UnoButton />

      {pendingWild && <ColorPicker onPick={chooseColor} onCancel={() => setPendingWild(null)} />}
    </div>
  );
}

// ------------------------------------------------------- 離開／音效開關

function GameTopBar() {
  const room = useStore((s) => s.room)!;
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="game__topbar">
      <span className="game__room">#{room.code}</span>
      <SoundToggles compact />
      <button
        type="button"
        className="game__leave"
        onClick={() => { actions.click(); setConfirming(true); }}
        aria-label="離開房間"
      >
        <Icon name="exit" size={20} />
      </button>

      {confirming && (
        <div className="picker-scrim" onClick={(e) => e.target === e.currentTarget && setConfirming(false)}>
          <div className="picker">
            <h3>要離開這場遊戲嗎？</h3>
            <p className="muted">離開後你的座位會由 AI 接手，牌局會繼續進行。</p>
            <div className="picker__actions">
              <Button tone="sky" onClick={() => { actions.click(); setConfirming(false); }}>繼續玩</Button>
              <Button tone="pink" onClick={() => { actions.click(); void actions.leaveRoom(); }}>離開房間</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------- 回合資訊

function TurnBar() {
  const game = useStore((s) => s.game)!;
  const room = useStore((s) => s.room)!;
  const me = useStore((s) => s.profile?.playerId);

  const nameOf = (id: string) =>
    id === me ? '你' : room.players.find((p) => p.id === id)?.nickname ?? '？';

  const remaining = useCountdown(game.turnDeadline);

  return (
    <div className="turnbar">
      <div className={`turnbar__now ${game.isMyTurn ? 'is-me' : ''}`}>
        <span className="turnbar__label">目前</span>
        <b>{nameOf(game.currentPlayerId)}</b>
        {remaining !== null && <span className="turnbar__timer">{remaining}s</span>}
      </div>
      <div className="turnbar__item">
        <span className="turnbar__label">下一位</span>
        <b>{nameOf(game.nextPlayerId)}</b>
      </div>
      <div className="turnbar__item" title={game.direction === 1 ? '順時針' : '逆時針'}>
        <span className="turnbar__label">方向</span>
        <b className="turnbar__dir">{game.direction === 1 ? '↻' : '↺'}</b>
      </div>
      <div className="turnbar__item">
        <span className="turnbar__label">牌堆</span>
        <b>{game.drawPileCount}</b>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 對手

function OpponentSeat({
  opponent,
  slot,
  isCurrent,
  canCatch,
}: {
  opponent: OpponentView;
  slot: string;
  isCurrent: boolean;
  canCatch: boolean;
}) {
  const emote = useStore((s) => s.emotes.find((e) => e.playerId === opponent.id));
  const fan = Math.min(opponent.handCount, 7);

  return (
    <div className={`oseat oseat--${slot} ${isCurrent ? 'is-current' : ''}`}>
      <div className="oseat__cards" aria-hidden>
        {Array.from({ length: fan }, (_, i) => (
          <UnoCard
            key={i}
            faceDown
            size="xs"
            style={{ marginLeft: i === 0 ? 0 : -18 }}
            rotate={(i - (fan - 1) / 2) * 4}
          />
        ))}
      </div>

      <div className="oseat__body">
        <div className="oseat__avatar">
          <Avatar id={opponent.avatar} size="md" dim={!opponent.connected} ring={isCurrent ? '#FFD644' : undefined} />
          <span className="oseat__count">{opponent.handCount}</span>
          {emote && <span className="oseat__emote">{emote.emote}</span>}
        </div>
        <span className="oseat__name">{opponent.nickname}</span>
        <div className="oseat__tags">
          {opponent.isAI && <Badge tone="violet">AI</Badge>}
          {opponent.aiTakeover && <Badge tone="ghost">AI 代打</Badge>}
          {!opponent.connected && !opponent.aiTakeover && <Badge tone="ghost">離線</Badge>}
          {opponent.saidUno && <Badge tone="pink">UNO!</Badge>}
        </div>
      </div>

      {canCatch && (
        <button
          type="button"
          className="oseat__catch"
          onClick={() => { actions.click(); void actions.catchUno(opponent.id); }}
        >
          抓 UNO！
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------ 桌面中央

/**
 * @param topOverride 出牌過場進行中時，棄牌堆先繼續顯示上一張，
 *                    等飛過來的牌落定才換成新的，避免同一張牌同時出現兩次。
 */
function TableCenter({
  discardRef,
  topOverride,
}: {
  discardRef: React.RefObject<HTMLDivElement>;
  topOverride: Card | null;
}) {
  const game = useStore((s) => s.game)!;
  const canDraw = game.isMyTurn && !game.hasDrawnThisTurn;
  const top = topOverride ?? game.discardTop;

  return (
    <div className="center">
      <div className="center__pile">
        <button
          type="button"
          className={`center__draw ${canDraw ? 'is-active' : ''}`}
          onClick={() => { actions.click(); if (game.isMyTurn) void actions.drawCard(); }}
          disabled={!game.isMyTurn}
          aria-label="抽牌"
        >
          <UnoCard faceDown size="md" />
          <span className="center__count">{game.drawPileCount}</span>
        </button>
        <span className="center__caption">抽牌堆</span>
      </div>

      <div className="center__pile">
        <div className="center__discard" ref={discardRef}>
          {top ? <UnoCard card={top} size="md" /> : <UnoCard faceDown size="md" />}
          {game.activeColor && (
            <span
              className="center__color"
              style={{ background: CARD_PALETTE[game.activeColor].base }}
              title={`目前顏色：${COLOR_LABEL[game.activeColor]}`}
            />
          )}
        </div>
        <span className="center__caption">
          {game.pendingDraw > 0 ? `累積 +${game.pendingDraw}` : '棄牌堆'}
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- 出牌過場

/** 牌在畫面中央亮相的時間 */
const FLIGHT_HOLD_MS = 320;
/** 從中央飛進棄牌堆的時間 */
const FLIGHT_FLY_MS = 320;

interface Flight {
  card: Card;
  /** 過場期間棄牌堆先顯示的那一張（上一張） */
  prev: Card;
  seq: number;
  done: () => void;
}

let flightSeq = 0;

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 棄牌堆頂端換牌時，安排一次「中央亮相 → 飛進牌堆」的過場。
 * 開局發的第一張、或中途重連時沒有「上一張」，就不播，直接顯示。
 */
function usePlayFlight(top: Card | null): Flight | null {
  const [flight, setFlight] = useState<Flight | null>(null);
  const shown = useRef<Card | null>(top);

  useEffect(() => {
    const prev = shown.current;
    if ((top?.id ?? null) === (prev?.id ?? null)) return;
    shown.current = top;
    if (!top || !prev || prefersReducedMotion()) {
      setFlight(null);
      return;
    }
    const seq = ++flightSeq;
    setFlight({ card: top, prev, seq, done: () => setFlight((f) => (f?.seq === seq ? null : f)) });
  }, [top]);

  return flight;
}

function PlayFlight({
  card,
  targetRef,
  onDone,
}: {
  card: Card;
  targetRef: React.RefObject<HTMLDivElement>;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dest, setDest] = useState<{ dx: number; dy: number; scale: number } | null>(null);

  // 亮相結束後量一次棄牌堆位置再飛，避免視窗縮放後座標過期
  useEffect(() => {
    const timer = setTimeout(() => {
      const el = ref.current;
      const target = targetRef.current;
      if (!el || !target) {
        onDone();
        return;
      }
      const from = el.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      setDest({
        dx: to.left + to.width / 2 - (from.left + from.width / 2),
        dy: to.top + to.height / 2 - (from.top + from.height / 2),
        // getBoundingClientRect 帶了放大後的尺寸，換算絕對縮放要用未變形的 offsetWidth
        scale: to.width / el.offsetWidth,
      });
    }, FLIGHT_HOLD_MS);
    return () => clearTimeout(timer);
  }, [targetRef, onDone]);

  // 以 transitionend 收尾，計時器只當保險；早一格移除會讓牌在落點前跳掉
  useEffect(() => {
    if (!dest) return;
    const el = ref.current;
    const finish = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === 'transform') onDone();
    };
    el?.addEventListener('transitionend', finish);
    const timer = setTimeout(onDone, FLIGHT_FLY_MS + 200);
    return () => {
      el?.removeEventListener('transitionend', finish);
      clearTimeout(timer);
    };
  }, [dest, onDone]);

  return (
    <div
      ref={ref}
      className={`flight ${dest ? 'is-flying' : ''}`}
      aria-hidden
      style={
        dest
          ? ({ '--dx': `${dest.dx}px`, '--dy': `${dest.dy}px`, '--fs': dest.scale } as React.CSSProperties)
          : undefined
      }
    >
      <div className="flight__pop">
        <UnoCard card={card} className="flight__card" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 手牌

const HAND_CARD_MAX = 108;
const HAND_CARD_MIN = 54;
/** 舒適間距：相鄰兩張的位移 = 卡寬 × 這個比例 */
const HAND_STEP_RATIO = 0.78;
/** 最擠也要露出左側 30%，角標（數字／符號）才讀得到 */
const HAND_MIN_STEP_RATIO = 0.3;
/** 真的塞不下時的下限，超過就讓它捲動 */
const HAND_HARD_STEP_RATIO = 0.18;

/** 依可用寬度算出卡寬與疊牌間距，讓整副手牌盡量一眼看完、不撐出畫面 */
function layoutHand(count: number, width: number): { cardW: number; step: number; overflowing: boolean } {
  const base = width >= 460 ? HAND_CARD_MAX : 92;
  if (count <= 1 || width <= 0) return { cardW: base, step: base, overflowing: false };

  const fitted = width / (1 + (count - 1) * HAND_MIN_STEP_RATIO);
  const cardW = Math.round(Math.max(HAND_CARD_MIN, Math.min(base, fitted)));
  const step = Math.max(
    cardW * HAND_HARD_STEP_RATIO,
    Math.min(cardW * HAND_STEP_RATIO, (width - cardW) / (count - 1)),
  );

  return { cardW, step, overflowing: cardW + (count - 1) * step > width + 0.5 };
}

function useContentWidth(ref: React.RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return width;
}

function MyHand({
  playable,
  onPlay,
  showStatus,
}: {
  playable: Set<string>;
  onPlay: (card: Card) => void;
  showStatus: boolean;
}) {
  const game = useStore((s) => s.game)!;
  const hand = game.hand;
  const railRef = useRef<HTMLDivElement>(null);
  const width = useContentWidth(railRef);
  const { cardW, step, overflowing } = layoutHand(hand.length, width);

  // 扇形展開：牌多的時候角度收斂，並夾住最大角度，免得旋轉後的外擴被容器裁掉
  const spread = useMemo(() => {
    const n = hand.length;
    const perCard = n <= 7 ? 4 : n <= 12 ? 2.5 : 1.6;
    return hand.map((_, i) => {
      const angle = (i - (n - 1) / 2) * perCard;
      return Math.max(-8, Math.min(8, angle));
    });
  }, [hand]);

  return (
    <div className="hand">
      {showStatus && <MyStatus />}
      <div
        ref={railRef}
        className={`hand__rail scroll-x ${overflowing ? 'is-tight' : ''}`}
        style={{ '--hand-card-h': `${Math.round((cardW * 200) / 140)}px` } as React.CSSProperties}
      >
        {hand.map((card, i) => (
          <UnoCard
            key={card.id}
            card={card}
            size="lg"
            rotate={spread[i]}
            playable={game.isMyTurn && playable.has(card.id)}
            dimmed={game.isMyTurn && !playable.has(card.id)}
            onClick={() => onPlay(card)}
            style={
              {
                '--card-w': `${cardW}px`,
                marginLeft: i === 0 ? 0 : `${Math.round(step - cardW)}px`,
                zIndex: i,
              } as React.CSSProperties
            }
          />
        ))}
        {hand.length === 0 && <p className="hand__empty">手牌已出完！</p>}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- 我的狀態

function MyStatus() {
  const game = useStore((s) => s.game)!;

  if (!game.isMyTurn) return null;

  return (
    <div className="mystatus">
      {game.pendingDraw > 0 && !game.playableIds.length && (
        <Button tone="pink" onClick={() => { actions.click(); void actions.drawCard(); }}>
          吞下 +{game.pendingDraw}
        </Button>
      )}
      {game.hasDrawnThisTurn && (
        <Button tone="sky" onClick={() => { actions.click(); void actions.passTurn(); }}>
          結束回合
        </Button>
      )}
      {!game.hasDrawnThisTurn && game.playableIds.length === 0 && game.pendingDraw === 0 && (
        <Button tone="gold" onClick={() => { actions.click(); void actions.drawCard(); }}>
          抽一張牌
        </Button>
      )}
    </div>
  );
}

// ------------------------------------------------------------- UNO 按鈕

function UnoButton() {
  const game = useStore((s) => s.game)!;
  const deadline = game.unoWindow?.deadline ?? null;
  const isMine = game.unoWindow !== null && game.canCallUno;
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    if (!isMine || deadline === null) { setMs(null); return; }
    const tick = () => setMs(Math.max(0, deadline - Date.now()));
    tick();
    const id = setInterval(tick, 60);
    return () => clearInterval(id);
  }, [isMine, deadline]);

  if (!game.canCallUno) return null;

  const ratio = ms === null ? 0 : ms / UNO_BUFFER_MS;

  return (
    <button
      type="button"
      className={`unobtn ${ms !== null ? 'is-counting' : 'is-race'}`}
      onClick={() => { actions.click(); void actions.callUno(); }}
    >
      <span className="unobtn__label">UNO!</span>
      {ms !== null && (
        <>
          <span className="unobtn__ring" style={{ ['--ratio' as string]: ratio }} />
          <span className="unobtn__ms">{(ms / 1000).toFixed(1)}s</span>
        </>
      )}
      {ms === null && <span className="unobtn__ms">快按！</span>}
    </button>
  );
}

// ------------------------------------------------------------------ 選色

function ColorPicker({ onPick, onCancel }: { onPick: (c: CardColor) => void; onCancel: () => void }) {
  return (
    <div className="picker-scrim" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="picker">
        <h3>選擇顏色</h3>
        <div className="picker__grid">
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className="picker__swatch"
              style={{ background: CARD_PALETTE[color].base, borderColor: CARD_PALETTE[color].dark }}
              onClick={() => { actions.click(); onPick(color); }}
            >
              {COLOR_LABEL[color]}
            </button>
          ))}
        </div>
        <Button tone="ghost" size="sm" onClick={() => { actions.click(); onCancel(); }}>取消</Button>
      </div>
    </div>
  );
}
