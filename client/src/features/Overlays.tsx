/** 全域覆蓋層：吐司、抓到 UNO 的醒目彈窗、UNO 閃現、連線遮罩。 */
import { Avatar, Button, Spinner } from '../components/ui.tsx';
import { actions, useStore } from '../store.ts';
import './Overlays.css';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const drop = useStore((s) => s.dropToast);

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`toast toast--${t.kind}`} onClick={() => drop(t.id)}>
          {t.text}
        </button>
      ))}
    </div>
  );
}

/** 規格要求的醒目通知：XXX 抓到了 XXX 未喊 UNO！＋動畫＋音效（音效在 store 觸發） */
export function CaughtBanner() {
  const caught = useStore((s) => s.caught);
  const dismiss = useStore((s) => s.dismissCaught);

  if (!caught) return null;

  return (
    <div className="caught-scrim" onClick={dismiss}>
      <div className="caught" role="alertdialog" aria-label="被抓 UNO">
        <div className="caught__burst" aria-hidden>
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} style={{ ['--i' as string]: i }} />
          ))}
        </div>

        <h2 className="caught__title">被抓 UNO！</h2>
        <Avatar id={caught.caughtAvatar} size="xl" className="caught__avatar" />
        <p className="caught__text">
          <b>{caught.catcherName}</b> 抓到了 <b>{caught.caughtName}</b> 未喊 UNO！
        </p>
        <p className="caught__penalty">罰抽兩張 🃏🃏</p>
        <Button tone="gold" onClick={() => { actions.click(); dismiss(); }}>
          {caught.isMe ? '嗚嗚…' : '知道了'}
        </Button>
      </div>
    </div>
  );
}

/** 有人喊 UNO 時中央閃一下 */
export function UnoFlash() {
  const flash = useStore((s) => s.unoFlash);
  if (!flash) return null;
  return (
    <div className="uno-flash" aria-hidden>
      <span className="uno-flash__word">UNO!</span>
      <span className="uno-flash__who">{flash.nickname}</span>
    </div>
  );
}

/** 斷線時蓋住畫面，避免玩家對著過期狀態亂點 */
export function ConnectionVeil() {
  const connected = useStore((s) => s.connected);
  const everConnected = useStore((s) => s.everConnected);

  if (connected) return null;

  return (
    <div className="veil">
      <Spinner />
      <p className="veil__text">
        {everConnected ? '連線中斷，正在重連…' : '連線中…'}
      </p>
      <p className="veil__hint">
        {everConnected ? '60 秒內回來就能接回原本的牌局' : '伺服器冷啟動可能需要約 30 秒'}
      </p>
    </div>
  );
}
