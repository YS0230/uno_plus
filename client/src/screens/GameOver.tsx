import { Avatar, Badge, Button, Icon } from '../components/ui.tsx';
import { actions, useStore } from '../store.ts';
import './GameOver.css';

const formatDuration = (ms: number): string => {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
};

const MEDALS = ['🥇', '🥈', '🥉'];

export function GameOver() {
  const result = useStore((s) => s.result)!;
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.profile?.playerId);
  const isHost = room?.hostId === me;
  const iWon = result.winnerId === me;

  return (
    <div className="over-scrim">
      <div className="over">
        <div className="over__crown">
          <Icon name="trophy" size={72} />
        </div>

        <h2 className="over__title">{iWon ? '你贏了！' : `${result.winnerNickname} 獲勝！`}</h2>
        <p className="over__time">
          <Icon name="clock" size={16} /> 遊戲時間 {formatDuration(result.durationMs)}
        </p>

        <ol className="over__list">
          {result.standings.map((s) => (
            <li key={s.playerId} className={`over__row ${s.playerId === me ? 'is-me' : ''}`}>
              <span className="over__rank">{MEDALS[s.rank - 1] ?? s.rank}</span>
              <Avatar id={s.avatar} size="sm" />
              <span className="over__name">
                {s.nickname}
                {s.playerId === me && <span className="over__you">（你）</span>}
              </span>
              {s.isAI && <Badge tone="violet">AI</Badge>}
              <span className="over__cards">剩 {s.cardsLeft} 張</span>
              <span className={`over__score ${s.rank === 1 ? 'is-win' : ''}`}>
                {s.rank === 1 ? '+100' : `-${s.penalty}`}
              </span>
            </li>
          ))}
        </ol>

        <div className="over__actions">
          <Button tone="sky" onClick={() => { actions.click(); void actions.leaveRoom(); }}>
            返回大廳
          </Button>
          {isHost ? (
            <Button tone="green" size="lg" onClick={() => { actions.click(); void actions.rematch(); }}>
              再玩一局
            </Button>
          ) : (
            <Button tone="ghost" disabled>等待房主再開一局…</Button>
          )}
        </div>
      </div>
    </div>
  );
}
