import { useEffect, useState } from 'react';
import { FELTS, type FeltId } from '@uno/shared';
import { Badge, Button, Field, Icon, Panel, Toggle } from '../components/ui.tsx';
import { actions, useStore } from '../store.ts';
import './Lobby.css';

// ------------------------------------------------------------------ 大廳

export function Lobby() {
  const list = useStore((s) => s.lobbyRooms);
  const setRoute = useStore((s) => s.setRoute);
  const [code, setCode] = useState('');

  useEffect(() => {
    actions.watchLobby(true);
    return () => actions.watchLobby(false);
  }, []);

  return (
    <div className="screen">
      <ScreenHeader title="公開房間" onBack={() => setRoute('home')} />

      <Panel className="lobby__panel">
        <div className="lobby__join">
          <input
            className="input"
            type="text"
            value={code}
            maxLength={6}
            placeholder="輸入 6 碼房號"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && code.trim()) void actions.joinRoom(code.trim());
            }}
          />
          <Button tone="green" onClick={() => { actions.click(); if (code.trim()) void actions.joinRoom(code.trim()); }}>
            加入
          </Button>
        </div>

        <div className="lobby__list scroll-y">
          {list.length === 0 && (
            <p className="lobby__empty">
              目前沒有公開房間
              <br />
              <span className="muted">建一間，讓大家來找你</span>
            </p>
          )}
          {list.map((room) => (
            <div key={room.code} className="lobby__row">
              <div className="lobby__info">
                <span className="lobby__name">
                  {room.name}
                  {room.hasPassword && <Icon name="shield" size={16} />}
                </span>
                <span className="lobby__code">#{room.code}</span>
              </div>
              <Badge tone={room.playerCount >= room.maxPlayers ? 'ghost' : 'sky'}>
                {room.playerCount}/{room.maxPlayers}
              </Badge>
              <Button
                size="sm"
                tone="green"
                disabled={room.playerCount >= room.maxPlayers}
                onClick={() => { actions.click(); void actions.joinRoom(room.code); }}
              >
                加入
              </Button>
            </div>
          ))}
        </div>
      </Panel>

      <Button tone="blue" onClick={() => { actions.click(); setRoute('create'); }}>
        建立新房間
      </Button>
    </div>
  );
}

// -------------------------------------------------------------- 建立房間

const FELT_LABEL: Record<FeltId, string> = {
  violet: '夢幻紫',
  green: '草地綠',
  blue: '海洋藍',
  pink: '草莓粉',
  wood: '木質棕',
};

export function CreateRoom() {
  const setRoute = useStore((s) => s.setRoute);
  const nickname = useStore((s) => s.profile?.nickname);

  const [name, setName] = useState(nickname ? `${nickname}的房間` : '快樂 UNO 房');
  const [password, setPassword] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [allowAI, setAllowAI] = useState(true);
  const [isPublic, setIsPublic] = useState(true);
  const [stacking, setStacking] = useState(false);
  const [felt, setFelt] = useState<FeltId>('violet');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    actions.click();
    setBusy(true);
    const result = await actions.createRoom({
      name: name.trim() || '快樂 UNO 房',
      password: password.trim() || undefined,
      maxPlayers,
      allowAI,
      isPublic,
      stacking,
      felt,
    });
    setBusy(false);
    if (!result) return;
  };

  return (
    <div className="screen">
      <ScreenHeader title="創建房間" onBack={() => setRoute('home')} />

      <Panel
        className="create__panel"
        footer={<Button tone="green" size="lg" onClick={create} disabled={busy}>創建</Button>}
      >
        <Field label="房間名稱">
          <input type="text" value={name} maxLength={16} placeholder="輸入房間名稱" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="房間密碼" hint="留空代表不設密碼">
          <input type="password" value={password} maxLength={20} placeholder="選填" onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="最大玩家">
          <select value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))}>
            {[2, 3, 4].map((n) => (
              <option key={n} value={n}>{n} 人</option>
            ))}
          </select>
        </Field>
        <Field label="桌布顏色">
          <select value={felt} onChange={(e) => setFelt(e.target.value as FeltId)}>
            {FELTS.map((f) => (
              <option key={f} value={f}>{FELT_LABEL[f]}</option>
            ))}
          </select>
        </Field>
        <Field label="允許 AI">
          <Toggle checked={allowAI} onChange={setAllowAI} label="允許 AI 玩家" />
        </Field>
        <Field label="公開房間" hint={isPublic ? '會顯示在大廳清單' : '只能用房號加入'}>
          <Toggle checked={isPublic} onChange={setIsPublic} label="公開房間" />
        </Field>
        <Field label="+2 可疊加" hint="開啟後 +2／+4 可以往下家疊">
          <Toggle checked={stacking} onChange={setStacking} label="加牌可疊加" />
        </Field>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ 說明

export function HowTo() {
  const setRoute = useStore((s) => s.setRoute);
  return (
    <div className="screen">
      <ScreenHeader title="遊戲說明" onBack={() => setRoute('home')} />
      <Panel className="howto__panel">
        <div className="howto scroll-y">
          <h3>目標</h3>
          <p>最快把手上的牌出完的人獲勝。</p>

          <h3>怎麼出牌</h3>
          <p>出的牌要跟棄牌堆最上面那張<b>同顏色</b>、<b>同數字</b>或<b>同功能</b>。黑色的變色牌隨時都能出。</p>
          <p>沒有牌可以出就抽一張；抽到的牌如果能出，可以馬上打出去，不然就結束回合。</p>

          <h3>功能牌</h3>
          <ul>
            <li><b>跳過</b> —— 下一位玩家直接被略過</li>
            <li><b>迴轉</b> —— 出牌方向反轉（兩人對戰時等同跳過）</li>
            <li><b>+2</b> —— 下家抽兩張並跳過</li>
            <li><b>變色</b> —— 由你指定接下來的顏色</li>
            <li><b>變色 +4</b> —— 指定顏色，下家抽四張並跳過</li>
          </ul>

          <h3>UNO！</h3>
          <p>手上<b>剩一張牌</b>時必須喊 UNO。</p>
          <ul>
            <li>出牌後有 <b>2 秒緩衝</b>，倒數立刻開始</li>
            <li>這 2 秒<b>只有你自己</b>能按 UNO，別人不能搶先舉報</li>
            <li>2 秒過了還沒按，其他玩家就能<b>抓你的 UNO</b></li>
            <li>被抓到要<b>罰抽兩張</b></li>
          </ul>

          <h3>離線與重連</h3>
          <p>斷線後 60 秒內回來可以直接接回原本的牌局；超過就由 AI 暫時接手，你回來之後還是能拿回控制權。</p>
        </div>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------- 共用頁首

export function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="screen__header">
      <Button tone="pink" round onClick={() => { actions.click(); onBack(); }} aria-label="返回">
        ←
      </Button>
      <h1 className="title-xl">{title}</h1>
      <span className="screen__spacer" />
    </header>
  );
}
