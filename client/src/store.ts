/** 全域狀態。伺服器是唯一事實來源，這裡只是把推播存下來給畫面用。 */
import { create } from 'zustand';
import type {
  AvatarId,
  CardColor,
  ChatMessage,
  CreateRoomInput,
  EmoteEvent,
  GameFeedEvent,
  GameResult,
  GameView,
  Profile,
  RoomSummary,
  RoomView,
} from '@uno/shared';
import { emit, socket, storage } from './net/socket.ts';
import { playSound, unlockAudio } from './audio/synth.ts';

export type Route = 'home' | 'lobby' | 'create' | 'howto';

export interface Toast {
  id: number;
  kind: 'info' | 'warn' | 'error' | 'success';
  text: string;
}

export interface CaughtBanner {
  catcherName: string;
  caughtName: string;
  caughtAvatar: AvatarId;
  isMe: boolean;
}

interface State {
  connected: boolean;
  /** 連過線至少一次 —— 用來區分「首次連線中」與「斷線重連中」 */
  everConnected: boolean;
  profile: Profile | null;

  route: Route;
  room: RoomView | null;
  game: GameView | null;
  result: GameResult | null;

  chat: ChatMessage[];
  emotes: EmoteEvent[];
  feed: GameFeedEvent[];
  lobbyRooms: RoomSummary[];
  toasts: Toast[];

  /** 有人喊 UNO 的閃現 */
  unoFlash: { nickname: string; at: number } | null;
  /** 抓到 UNO 的醒目彈窗 */
  caught: CaughtBanner | null;

  setRoute: (route: Route) => void;
  dismissCaught: () => void;
  toast: (kind: Toast['kind'], text: string) => void;
  dropToast: (id: number) => void;
}

let toastSeq = 0;

export const useStore = create<State>((set, get) => ({
  connected: false,
  everConnected: false,
  profile: null,

  route: 'home',
  room: null,
  game: null,
  result: null,

  chat: [],
  emotes: [],
  feed: [],
  lobbyRooms: [],
  toasts: [],

  unoFlash: null,
  caught: null,

  setRoute: (route) => set({ route }),
  dismissCaught: () => set({ caught: null }),

  toast: (kind, text) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts.slice(-3), { id, kind, text }] });
    setTimeout(() => get().dropToast(id), 3200);
  },
  dropToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

// --------------------------------------------------------------- 事件接線

let wired = false;

export function connect(): void {
  if (wired) return;
  wired = true;

  const st = () => useStore.getState();

  socket.on('connect', () => {
    useStore.setState({ connected: true });
    void emit('identify', {
      sessionToken: storage.token,
      nickname: storage.nickname,
      avatar: storage.avatar,
    }).catch(() => {});
  });

  socket.on('disconnect', () => useStore.setState({ connected: false }));

  socket.on('session', (profile) => {
    storage.token = profile.sessionToken;
    storage.nickname = profile.nickname;
    storage.avatar = profile.avatar;
    useStore.setState({ profile, everConnected: true });
  });

  socket.on('lobby:rooms', (lobbyRooms) => useStore.setState({ lobbyRooms }));

  socket.on('room:state', (room) => {
    const prev = st().room;
    // 離開房間就把對局殘留一併清掉
    if (!room) {
      useStore.setState({ room: null, game: null, result: null, chat: [], feed: [], emotes: [] });
      return;
    }
    if (prev && prev.code !== room.code) {
      useStore.setState({ chat: [], feed: [], emotes: [], game: null, result: null });
    }
    if (room.phase === 'lobby' && prev?.phase !== 'lobby') {
      useStore.setState({ result: null });
    }
    useStore.setState({ room });
  });

  socket.on('game:state', (game) => {
    const prev = st().game;

    // startedAt 變了就是新的一局（例如「再玩一局」）—— 要把上一局的結算畫面收掉，
    // 否則結算彈窗會一直蓋在新牌桌上面
    const isNewGame = prev === null || prev.startedAt !== game.startedAt;
    if (isNewGame) useStore.setState({ result: null, feed: [] });

    // 換自己的回合時提醒一聲
    if (game.isMyTurn && prev && !prev.isMyTurn) playSound('turn');
    useStore.setState({ game });
  });

  socket.on('game:feed', (event) => {
    const me = st().profile?.playerId;
    useStore.setState({ feed: [...st().feed.slice(-20), event] });

    if (event.type === 'played') playSound('play');
    if (event.type === 'drew' || event.type === 'penalty') {
      if (event.playerId === me) playSound('draw');
    }
  });

  socket.on('game:over', (result) => {
    const me = st().profile?.playerId;
    useStore.setState({ result });
    playSound(result.winnerId === me ? 'win' : 'lose');
  });

  socket.on('uno:called', ({ playerId, nickname }) => {
    playSound('uno');
    useStore.setState({ unoFlash: { nickname, at: Date.now() } });
    setTimeout(() => {
      if (st().unoFlash?.nickname === nickname) useStore.setState({ unoFlash: null });
    }, 1800);
    if (playerId !== st().profile?.playerId) st().toast('info', `${nickname} 喊了 UNO！`);
  });

  socket.on('uno:caught', ({ catcherName, caughtId, caughtName, caughtAvatar }) => {
    playSound('caught');
    useStore.setState({
      caught: { catcherName, caughtName, caughtAvatar, isMe: caughtId === st().profile?.playerId },
    });
  });

  socket.on('chat:history', (messages) => useStore.setState({ chat: messages }));

  socket.on('chat:message', (message) => {
    useStore.setState({ chat: [...st().chat.slice(-59), message] });
    if (message.kind === 'system' && message.text.includes('加入')) playSound('join');
  });

  socket.on('chat:emote', (event) => {
    useStore.setState({ emotes: [...st().emotes.filter((e) => e.playerId !== event.playerId), event] });
    setTimeout(() => {
      useStore.setState({ emotes: useStore.getState().emotes.filter((e) => e.at !== event.at) });
    }, 3000);
  });

  socket.on('toast', ({ kind, text }) => st().toast(kind, text));

  socket.on('kicked', ({ reason }) => {
    st().toast('error', reason);
    useStore.setState({ route: 'home', room: null, game: null, result: null });
  });

  socket.connect();
}

// ------------------------------------------------------------------ 動作

/** 統一處理 ack 失敗 → 吐司提示，畫面端就不用每次 try/catch */
async function run<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (error) {
    useStore.getState().toast('error', error instanceof Error ? error.message : '操作失敗');
    return null;
  }
}

export const actions = {
  click(): void {
    unlockAudio();
    playSound('click');
  },

  updateProfile(nickname: string, avatar: AvatarId) {
    return run(emit('profile:update', { nickname, avatar }));
  },

  watchLobby(on: boolean): void {
    socket.emit('lobby:subscribe', { on });
  },

  createRoom(input: CreateRoomInput) {
    return run(emit('room:create', input));
  },

  joinRoom(code: string, password?: string) {
    return run(emit('room:join', { code, password }));
  },

  quickPlay() {
    return run(emit('room:join', { code: '' }));
  },

  leaveRoom() {
    return run(emit('room:leave'));
  },

  ready(ready: boolean) {
    return run(emit('room:ready', { ready }));
  },

  kick(playerId: string) {
    return run(emit('room:kick', { playerId }));
  },

  addAI() {
    return run(emit('room:addAI'));
  },

  removeAI(playerId: string) {
    return run(emit('room:removeAI', { playerId }));
  },

  start() {
    return run(emit('room:start'));
  },

  rematch() {
    return run(emit('room:rematch'));
  },

  playCard(cardId: string, chosenColor?: CardColor) {
    return run(emit('game:play', { cardId, chosenColor }));
  },

  drawCard() {
    return run(emit('game:draw'));
  },

  passTurn() {
    return run(emit('game:pass'));
  },

  callUno() {
    return run(emit('game:callUno'));
  },

  catchUno(targetId: string) {
    return run(emit('game:catchUno', { targetId }));
  },

  sendChat(text: string) {
    return run(emit('chat:send', { text }));
  },

  sendEmote(emote: string) {
    return run(emit('chat:emote', { emote }));
  },
};
