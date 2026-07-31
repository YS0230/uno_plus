import { useEffect, useMemo, useState } from 'react';
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

        <TableCenter />
      </div>

      <MyHand playable={playable} onPlay={playCard} />

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
      {me && <MyStatus />}
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

function TableCenter() {
  const game = useStore((s) => s.game)!;
  const canDraw = game.isMyTurn && !game.hasDrawnThisTurn;

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
        <div className="center__discard">
          {game.discardTop ? <UnoCard card={game.discardTop} size="md" /> : <UnoCard faceDown size="md" />}
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

// ------------------------------------------------------------------ 手牌

function MyHand({ playable, onPlay }: { playable: Set<string>; onPlay: (card: Card) => void }) {
  const game = useStore((s) => s.game)!;
  const hand = game.hand;

  // 扇形展開：牌多的時候角度收斂，並夾住最大角度，免得旋轉後的外擴被容器裁掉
  const spread = useMemo(() => {
    const n = hand.length;
    const perCard = n <= 7 ? 4 : n <= 12 ? 2.5 : 1.6;
    return hand.map((_, i) => {
      const angle = (i - (n - 1) / 2) * perCard;
      return Math.max(-10, Math.min(10, angle));
    });
  }, [hand]);

  return (
    <div className="hand">
      <div className="hand__rail scroll-x">
        {hand.map((card, i) => (
          <UnoCard
            key={card.id}
            card={card}
            size="lg"
            rotate={spread[i]}
            playable={game.isMyTurn && playable.has(card.id)}
            dimmed={game.isMyTurn && !playable.has(card.id)}
            onClick={() => onPlay(card)}
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
