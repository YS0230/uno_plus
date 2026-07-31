import { useEffect, useRef, useState } from 'react';
import { Avatar, Button } from '../components/ui.tsx';
import { actions, useStore } from '../store.ts';
import './Chat.css';

/** 素材圖 EMOJI 區的那組表情。用原生 emoji —— 任何尺寸都銳利。 */
export const EMOTES = ['😂', '😭', '😎', '😠', '❤️', '👏', '🎉', '😈'] as const;

/** 素材圖的快速訊息 */
export const QUICK_MESSAGES = [
  '歡迎你',
  '怎麼會!',
  '太強了',
  '不要啊',
  '哈哈哈',
  'Nice~',
  '讚!',
  'GG',
] as const;

export function Chat({ compact = false }: { compact?: boolean }) {
  const chat = useStore((s) => s.chat);
  const me = useStore((s) => s.profile?.playerId);
  const [text, setText] = useState('');
  const [panel, setPanel] = useState<'none' | 'emote' | 'quick'>('none');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

  const send = () => {
    const value = text.trim();
    if (!value) return;
    void actions.sendChat(value);
    setText('');
  };

  return (
    <div className={`chat ${compact ? 'chat--compact' : ''}`}>
      <div className="chat__list scroll-y" ref={listRef}>
        {chat.length === 0 && <p className="chat__hint">說點什麼吧 👋</p>}
        {chat.map((m) =>
          m.kind === 'system' ? (
            <p key={m.id} className="chat__system">{m.text}</p>
          ) : (
            <div key={m.id} className={`chat__msg ${m.playerId === me ? 'is-me' : ''}`}>
              {m.avatar && <Avatar id={m.avatar} size="xs" />}
              <div className="chat__bubble">
                <span className="chat__author">{m.nickname}</span>
                <span className="chat__text">{m.text}</span>
              </div>
            </div>
          ),
        )}
      </div>

      {panel === 'emote' && (
        <div className="chat__tray">
          {EMOTES.map((e) => (
            <button key={e} type="button" className="chat__emote" onClick={() => { void actions.sendEmote(e); setPanel('none'); }}>
              {e}
            </button>
          ))}
        </div>
      )}

      {panel === 'quick' && (
        <div className="chat__tray chat__tray--quick">
          {QUICK_MESSAGES.map((q) => (
            <button key={q} type="button" className="chat__quick" onClick={() => { void actions.sendChat(q); setPanel('none'); }}>
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="chat__composer">
        <button
          type="button"
          className={`chat__toggle ${panel === 'emote' ? 'is-on' : ''}`}
          onClick={() => setPanel(panel === 'emote' ? 'none' : 'emote')}
          aria-label="表情"
        >
          😀
        </button>
        <button
          type="button"
          className={`chat__toggle ${panel === 'quick' ? 'is-on' : ''}`}
          onClick={() => setPanel(panel === 'quick' ? 'none' : 'quick')}
          aria-label="快速訊息"
        >
          💬
        </button>
        <input
          className="chat__input"
          type="text"
          value={text}
          maxLength={120}
          placeholder="說點什麼…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <Button size="sm" tone="sky" onClick={send} disabled={!text.trim()}>送出</Button>
      </div>
    </div>
  );
}
