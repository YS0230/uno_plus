import { useEffect } from 'react';
import { connect, useStore } from './store.ts';
import { unlockAudio } from './audio/synth.ts';
import { Home } from './screens/Home.tsx';
import { CreateRoom, HowTo, Lobby } from './screens/Lobby.tsx';
import { Room } from './screens/Room.tsx';
import { Game } from './screens/Game.tsx';
import { GameOver } from './screens/GameOver.tsx';
import { CaughtBanner, ConnectionVeil, Toasts, UnoFlash } from './features/Overlays.tsx';

export function App() {
  const route = useStore((s) => s.route);
  const room = useStore((s) => s.room);
  const game = useStore((s) => s.game);
  const result = useStore((s) => s.result);

  useEffect(() => {
    connect();
    // 瀏覽器的 autoplay 政策：第一次互動後才能出聲
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  return (
    <>
      {room ? <InRoom /> : <OutOfRoom route={route} />}

      {result && <GameOver />}
      <UnoFlash />
      <CaughtBanner />
      <Toasts />
      <ConnectionVeil />

      {/* 對局中的無障礙播報 */}
      <TurnAnnouncer isMyTurn={Boolean(game?.isMyTurn)} />
    </>
  );
}

function OutOfRoom({ route }: { route: ReturnType<typeof useStore.getState>['route'] }) {
  switch (route) {
    case 'lobby': return <Lobby />;
    case 'create': return <CreateRoom />;
    case 'howto': return <HowTo />;
    default: return <Home />;
  }
}

function InRoom() {
  const room = useStore((s) => s.room)!;
  const game = useStore((s) => s.game);

  // 結算階段也要繼續顯示牌桌（結算彈窗蓋在上面），只有回到 lobby 才切回房間畫面
  return game && room.phase !== 'lobby' ? <Game /> : <Room />;
}

function TurnAnnouncer({ isMyTurn }: { isMyTurn: boolean }) {
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {isMyTurn ? '輪到你出牌了' : ''}
    </p>
  );
}
