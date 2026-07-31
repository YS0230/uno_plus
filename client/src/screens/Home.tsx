import { useState } from 'react';
import { AVATARS, type AvatarId } from '@uno/shared';
import { Avatar, Button, Field, Icon, Modal } from '../components/ui.tsx';
import { actions, useStore } from '../store.ts';
import { isBgmOn, isSfxOn, setBgm, setSfx } from '../audio/synth.ts';
import './Home.css';

export function Home() {
  const profile = useStore((s) => s.profile);
  const setRoute = useStore((s) => s.setRoute);
  const [editing, setEditing] = useState(false);
  const [joining, setJoining] = useState(false);

  return (
    <div className="home">
      <PlayerChip onEdit={() => setEditing(true)} />

      <div className="home__hero">
        <img className="home__logo" src="/assets/logo.png" alt="UNO" width={280} />
        <p className="home__tagline">泡泡糖玩具風 · 即時多人對戰</p>
      </div>

      <div className="home__menu">
        <Button tone="gold" size="lg" block onClick={() => { actions.click(); void quickPlay(); }}>
          開始遊戲
        </Button>
        <Button tone="blue" size="lg" block onClick={() => { actions.click(); setRoute('create'); }}>
          建立房間
        </Button>
        <Button tone="green" size="lg" block onClick={() => { actions.click(); setJoining(true); }}>
          加入房間
        </Button>
        <Button tone="violet" size="lg" block onClick={() => { actions.click(); setRoute('howto'); }}>
          <Icon name="help" size={20} /> 遊戲說明
        </Button>
      </div>

      <SoundToggles />

      {editing && profile && <ProfileModal onClose={() => setEditing(false)} />}
      {joining && <JoinModal onClose={() => setJoining(false)} />}
    </div>
  );
}

async function quickPlay() {
  const result = await actions.quickPlay();
  if (!result) useStore.getState().setRoute('lobby');
}

// ------------------------------------------------------------- 玩家資訊卡

function PlayerChip({ onEdit }: { onEdit: () => void }) {
  const profile = useStore((s) => s.profile);
  const connected = useStore((s) => s.connected);

  return (
    <button type="button" className="player-chip" onClick={() => { actions.click(); onEdit(); }}>
      {profile ? <Avatar id={profile.avatar} size="sm" /> : <div className="player-chip__ghost" />}
      <span className="player-chip__name">{profile?.nickname ?? '連線中…'}</span>
      <span className={`player-chip__dot ${connected ? 'is-on' : ''}`} aria-hidden />
      <span className="sr-only">{connected ? '已連線' : '連線中'}</span>
    </button>
  );
}

function ProfileModal({ onClose }: { onClose: () => void }) {
  const profile = useStore((s) => s.profile)!;
  const [nickname, setNickname] = useState(profile.nickname);
  const [avatar, setAvatar] = useState<AvatarId>(profile.avatar);

  const save = async () => {
    actions.click();
    const trimmed = nickname.trim();
    if (!trimmed) {
      useStore.getState().toast('warn', '暱稱不能空白');
      return;
    }
    await actions.updateProfile(trimmed, avatar);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="玩家設定"
      footer={
        <>
          <Button tone="sky" onClick={() => { actions.click(); onClose(); }}>取消</Button>
          <Button tone="green" onClick={save}>確定</Button>
        </>
      }
    >
      <Field label="暱稱">
        <input
          type="text"
          value={nickname}
          maxLength={12}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="輸入暱稱"
        />
      </Field>
      <p className="muted">選一個頭像</p>
      <div className="avatar-grid">
        {AVATARS.map((id) => (
          <button
            key={id}
            type="button"
            className={`avatar-grid__item ${id === avatar ? 'is-active' : ''}`}
            onClick={() => { actions.click(); setAvatar(id); }}
            aria-label={id}
            aria-pressed={id === avatar}
          >
            <Avatar id={id} size="md" />
          </button>
        ))}
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------- 加入房間

function JoinModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const join = async () => {
    actions.click();
    if (!code.trim()) {
      useStore.getState().toast('warn', '請輸入房號');
      return;
    }
    setBusy(true);
    const result = await actions.joinRoom(code.trim().toUpperCase(), password || undefined);
    setBusy(false);
    if (result) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="加入房間"
      footer={
        <>
          <Button tone="sky" onClick={() => { actions.click(); onClose(); }}>取消</Button>
          <Button tone="green" onClick={join} disabled={busy}>加入</Button>
        </>
      }
    >
      <Field label="房號">
        <input
          type="text"
          value={code}
          maxLength={6}
          placeholder="6 碼房號"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && void join()}
        />
      </Field>
      <Field label="密碼" hint="沒有密碼就留空">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="選填"
        />
      </Field>
      <Button tone="ghost" block onClick={() => { actions.click(); useStore.getState().setRoute('lobby'); onClose(); }}>
        瀏覽公開房間
      </Button>
    </Modal>
  );
}

// ------------------------------------------------------------------ 音效

export function SoundToggles({ compact = false }: { compact?: boolean }) {
  const [sfx, setSfxState] = useState(isSfxOn());
  const [bgm, setBgmState] = useState(isBgmOn());

  return (
    <div className={`sound-toggles ${compact ? 'sound-toggles--compact' : ''}`}>
      <button
        type="button"
        className={`sound-toggles__btn ${sfx ? 'is-on' : ''}`}
        onClick={() => { setSfx(!sfx); setSfxState(!sfx); }}
        aria-pressed={sfx}
        aria-label={sfx ? '關閉音效' : '開啟音效'}
        title={sfx ? '關閉音效' : '開啟音效'}
      >
        <Icon name="sound" size={22} />
      </button>
      <button
        type="button"
        className={`sound-toggles__btn ${bgm ? 'is-on' : ''}`}
        onClick={() => { setBgm(!bgm); setBgmState(!bgm); }}
        aria-pressed={bgm}
        aria-label={bgm ? '關閉背景音樂' : '開啟背景音樂'}
        title={bgm ? '關閉背景音樂' : '開啟背景音樂'}
      >
        <Icon name="music" size={22} />
      </button>
    </div>
  );
}
