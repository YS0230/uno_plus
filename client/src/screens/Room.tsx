import { Avatar, Badge, Button, Icon, Panel } from '../components/ui.tsx';
import { Chat } from '../features/Chat.tsx';
import { actions, useStore } from '../store.ts';
import './Room.css';

export function Room() {
  const room = useStore((s) => s.room)!;
  const me = useStore((s) => s.profile?.playerId);

  const isHost = room.hostId === me;
  const myPlayer = room.players.find((p) => p.id === me);
  const canStart = room.players.length >= 2 && room.players.every((p) => p.id === room.hostId || p.isReady);
  const seats = [...room.players, ...Array.from({ length: Math.max(0, room.options.maxPlayers - room.players.length) })];

  const copyCode = async () => {
    actions.click();
    try {
      await navigator.clipboard.writeText(room.code);
      useStore.getState().toast('success', `房號 ${room.code} 已複製`);
    } catch {
      useStore.getState().toast('info', `房號：${room.code}`);
    }
  };

  return (
    <div className="room">
      <header className="room__header">
        <Button tone="pink" round onClick={() => { actions.click(); void actions.leaveRoom(); }} aria-label="離開房間">
          ←
        </Button>
        <div className="room__title">
          <h1>{room.options.name}</h1>
          <button type="button" className="room__code" onClick={copyCode}>
            #{room.code} <span className="room__copy">點擊複製</span>
          </button>
        </div>
        <span className="screen__spacer" />
      </header>

      <div className="room__grid">
        <Panel title={`玩家（${room.players.length}/${room.options.maxPlayers}）`} className="room__players">
          <div className="room__seats">
            {seats.map((slot, i) => {
              const player = slot as (typeof room.players)[number] | undefined;
              if (!player) {
                return (
                  <div key={`empty-${i}`} className="seat seat--empty">
                    <div className="seat__hole" />
                    <span className="seat__name">等待加入…</span>
                    {isHost && room.options.allowAI && (
                      <Button size="sm" tone="violet" onClick={() => { actions.click(); void actions.addAI(); }}>
                        + AI
                      </Button>
                    )}
                  </div>
                );
              }
              return (
                <div key={player.id} className={`seat ${player.isReady ? 'is-ready' : ''}`}>
                  <Avatar id={player.avatar} size="lg" dim={!player.connected} />
                  <span className="seat__name">
                    {player.nickname}
                    {player.id === me && <span className="seat__you">（你）</span>}
                  </span>
                  <div className="seat__tags">
                    {player.isHost && <Badge tone="gold"><Icon name="crown" size={12} /> 房主</Badge>}
                    {player.isAI && <Badge tone="violet">AI</Badge>}
                    {!player.connected && <Badge tone="ghost">離線</Badge>}
                    {player.isReady && !player.isHost && <Badge tone="green">已準備</Badge>}
                  </div>
                  {isHost && player.id !== me && (
                    <button
                      type="button"
                      className="seat__kick"
                      aria-label={`移除 ${player.nickname}`}
                      onClick={() => {
                        actions.click();
                        void (player.isAI ? actions.removeAI(player.id) : actions.kick(player.id));
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="room__settings muted">
            <span>最大 {room.options.maxPlayers} 人</span>
            <span>·</span>
            <span>{room.options.isPublic ? '公開' : '私人'}</span>
            <span>·</span>
            <span>{room.options.allowAI ? '允許 AI' : '不允許 AI'}</span>
            {room.options.stacking && <><span>·</span><span>+2 可疊加</span></>}
          </div>
        </Panel>

        <Panel title="聊天室" className="room__chat">
          <Chat />
        </Panel>
      </div>

      <footer className="room__actions">
        {isHost ? (
          <>
            {room.options.allowAI && room.players.length < room.options.maxPlayers && (
              <Button tone="violet" onClick={() => { actions.click(); void actions.addAI(); }}>新增 AI</Button>
            )}
            <Button tone="gold" size="lg" disabled={!canStart} onClick={() => { actions.click(); void actions.start(); }}>
              開始遊戲
            </Button>
          </>
        ) : (
          <Button
            tone={myPlayer?.isReady ? 'sky' : 'gold'}
            size="lg"
            onClick={() => { actions.click(); void actions.ready(!myPlayer?.isReady); }}
          >
            {myPlayer?.isReady ? '取消準備' : '準備'}
          </Button>
        )}
      </footer>

      {isHost && !canStart && room.players.length >= 2 && (
        <p className="room__waiting muted">等待其他玩家準備…</p>
      )}
      {room.players.length < 2 && <p className="room__waiting muted">至少要兩位玩家才能開始</p>}
    </div>
  );
}
