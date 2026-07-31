/**
 * 端對端測試：真的開一個 Socket.IO server，用真的 client 連上去走完整流程。
 * 這裡驗的是 handlers 的接線（房間、權限、聊天、對局、重連），規則本身由 game.test.ts 顧。
 */
import { createServer, type Server as HttpServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  GameResult,
  GameView,
  Profile,
  RoomView,
  ServerToClientEvents,
} from '@uno/shared';
import { registerHandlers } from './handlers.ts';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let httpServer: HttpServer;
let ioServer: Server;
let port: number;
const clients: ClientSocket[] = [];

beforeEach(async () => {
  httpServer = createServer();
  ioServer = new Server(httpServer);
  registerHandlers(ioServer as never);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  port = (httpServer.address() as { port: number }).port;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  ioServer.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

/** 連一個 client 並完成 identify */
async function makeClient(nickname?: string): Promise<{ socket: ClientSocket; profile: Profile }> {
  const socket: ClientSocket = connect(`http://localhost:${port}`, { transports: ['websocket'] });
  clients.push(socket);
  await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
  const profile = await call<Profile>(socket, 'identify', { nickname });
  return { socket, profile };
}

/** 呼叫一個帶 ack 的事件，ok=false 就 reject */
function call<T>(socket: ClientSocket, event: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} 逾時`)), 4000);
    (socket.emit as (e: string, ...a: unknown[]) => void)(event, ...args, (res: { ok: boolean; data?: T; error?: string }) => {
      clearTimeout(timer);
      if (res.ok) resolve(res.data as T);
      else reject(new Error(res.error));
    });
  });
}

/** 等到某個事件的 payload 通過檢查為止 */
function waitFor<E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
  predicate: (payload: Parameters<ServerToClientEvents[E]>[0]) => boolean = () => true,
  timeoutMs = 15000,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler as never);
      reject(new Error(`等不到 ${String(event)}`));
    }, timeoutMs);
    const handler = (payload: Parameters<ServerToClientEvents[E]>[0]) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler as never);
      resolve(payload);
    };
    socket.on(event, handler as never);
  });
}

const ROOM = {
  name: '測試房',
  maxPlayers: 4,
  allowAI: true,
  isPublic: true,
  stacking: false,
  felt: 'violet' as const,
};

describe('大廳與房間', () => {
  it('建房後會出現在公開房間清單', async () => {
    const host = await makeClient('房主');
    const { code } = await call<{ code: string }>(host.socket, 'room:create', ROOM);
    expect(code).toHaveLength(6);

    const guest = await makeClient('路人');
    const list = await call<Array<{ code: string; name: string }>>(guest.socket, 'lobby:list');
    expect(list.map((r) => r.code)).toContain(code);
  });

  it('私人房不會出現在清單，但可以用房號加入', async () => {
    const host = await makeClient('房主');
    const { code } = await call<{ code: string }>(host.socket, 'room:create', { ...ROOM, isPublic: false });

    const guest = await makeClient('路人');
    const list = await call<Array<{ code: string }>>(guest.socket, 'lobby:list');
    expect(list.map((r) => r.code)).not.toContain(code);

    await expect(call(guest.socket, 'room:join', { code })).resolves.toBeTruthy();
  });

  it('密碼錯誤會被擋下來', async () => {
    const host = await makeClient('房主');
    const { code } = await call<{ code: string }>(host.socket, 'room:create', { ...ROOM, password: 'secret' });

    const guest = await makeClient('路人');
    await expect(call(guest.socket, 'room:join', { code })).rejects.toThrow('房間密碼不正確');
    await expect(call(guest.socket, 'room:join', { code, password: 'wrong' })).rejects.toThrow('房間密碼不正確');
    await expect(call(guest.socket, 'room:join', { code, password: 'secret' })).resolves.toBeTruthy();
  });

  it('房間滿了就進不去', async () => {
    const host = await makeClient('房主');
    const { code } = await call<{ code: string }>(host.socket, 'room:create', { ...ROOM, maxPlayers: 2 });

    const a = await makeClient('A');
    await call(a.socket, 'room:join', { code });

    const b = await makeClient('B');
    await expect(call(b.socket, 'room:join', { code })).rejects.toThrow('房間已滿');
  });

  it('只有房主能開始遊戲、踢人、加 AI', async () => {
    const host = await makeClient('房主');
    const { code } = await call<{ code: string }>(host.socket, 'room:create', ROOM);
    const guest = await makeClient('路人');
    await call(guest.socket, 'room:join', { code });

    await expect(call(guest.socket, 'room:addAI')).rejects.toThrow('只有房主可以新增 AI');
    await expect(call(guest.socket, 'room:kick', { playerId: host.profile.playerId })).rejects.toThrow('只有房主可以踢人');
    await expect(call(guest.socket, 'room:start')).rejects.toThrow('只有房主可以開始遊戲');
  });

  it('有人沒準備就不能開始', async () => {
    const host = await makeClient('房主');
    const { code } = await call<{ code: string }>(host.socket, 'room:create', ROOM);
    const guest = await makeClient('路人');
    await call(guest.socket, 'room:join', { code });

    await expect(call(host.socket, 'room:start')).rejects.toThrow('還有玩家沒有準備');

    await call(guest.socket, 'room:ready', { ready: true });
    await expect(call(host.socket, 'room:start')).resolves.toBeNull();
  });

  it('被踢的人會收到通知並離開房間', async () => {
    const host = await makeClient('房主');
    const { code } = await call<{ code: string }>(host.socket, 'room:create', ROOM);
    const guest = await makeClient('路人');
    await call(guest.socket, 'room:join', { code });

    const kicked = waitFor(guest.socket, 'kicked');
    await call(host.socket, 'room:kick', { playerId: guest.profile.playerId });
    await expect(kicked).resolves.toMatchObject({ reason: expect.any(String) });
  });

  it('AI 玩家會被標記成 AI 且自動準備', async () => {
    const host = await makeClient('房主');
    const { code } = await call<{ code: string }>(host.socket, 'room:create', ROOM);

    const updated = waitFor<'room:state'>(host.socket, 'room:state', (r) => (r?.players.length ?? 0) === 2);
    await call(host.socket, 'room:addAI');
    const room = (await updated) as RoomView;

    const ai = room.players.find((p) => p.isAI)!;
    expect(ai.isReady).toBe(true);
    expect(code).toBe(room.code);
  });
});

describe('聊天室', () => {
  it('訊息會廣播給房內所有人', async () => {
    const host = await makeClient('房主');
    const { code } = await call<{ code: string }>(host.socket, 'room:create', ROOM);
    const guest = await makeClient('路人');
    await call(guest.socket, 'room:join', { code });

    const received = waitFor(guest.socket, 'chat:message', (m) => m.kind === 'player');
    await call(host.socket, 'chat:send', { text: '哈囉大家好' });

    const message = await received;
    expect(message).toMatchObject({ kind: 'player', nickname: '房主', text: '哈囉大家好' });
  });

  it('空白訊息會被擋下來', async () => {
    const host = await makeClient('房主');
    await call(host.socket, 'room:create', ROOM);
    await expect(call(host.socket, 'chat:send', { text: '   ' })).rejects.toThrow('訊息不能空白');
  });

  it('加入房間會產生系統訊息', async () => {
    const host = await makeClient('房主');
    const { code } = await call<{ code: string }>(host.socket, 'room:create', ROOM);

    const joined = waitFor(host.socket, 'chat:message', (m) => m.kind === 'system' && m.text.includes('加入'));
    const guest = await makeClient('路人');
    await call(guest.socket, 'room:join', { code });
    await expect(joined).resolves.toBeTruthy();
  });

  it('表情會廣播出去', async () => {
    const host = await makeClient('房主');
    const { code } = await call<{ code: string }>(host.socket, 'room:create', ROOM);
    const guest = await makeClient('路人');
    await call(guest.socket, 'room:join', { code });

    const emote = waitFor(guest.socket, 'chat:emote');
    await call(host.socket, 'chat:emote', { emote: '😂' });
    await expect(emote).resolves.toMatchObject({ playerId: host.profile.playerId, emote: '😂' });
  });
});

describe('對局', () => {
  it('開局後每個人拿到的視角都看不到別人的手牌', async () => {
    const host = await makeClient('房主');
    const { code } = await call<{ code: string }>(host.socket, 'room:create', { ...ROOM, maxPlayers: 2 });
    const guest = await makeClient('路人');
    await call(guest.socket, 'room:join', { code });
    await call(guest.socket, 'room:ready', { ready: true });

    const hostView = waitFor<'game:state'>(host.socket, 'game:state');
    const guestView = waitFor<'game:state'>(guest.socket, 'game:state');
    await call(host.socket, 'room:start');

    const [a, b] = (await Promise.all([hostView, guestView])) as GameView[];
    expect(a.hand.length).toBeGreaterThanOrEqual(7);
    expect(b.hand.length).toBeGreaterThanOrEqual(7);
    expect(a.opponents[0].handCount).toBe(b.hand.length);
    // 兩人拿到的手牌不能一樣，也不該包含對方的牌
    expect(a.hand.map((c) => c.id)).not.toEqual(b.hand.map((c) => c.id));
    expect(JSON.stringify(a.opponents)).not.toContain('"kind"');
  });

  it('非當前玩家出牌會被拒絕', async () => {
    const host = await makeClient('房主');
    const { code } = await call<{ code: string }>(host.socket, 'room:create', { ...ROOM, maxPlayers: 2 });
    const guest = await makeClient('路人');
    await call(guest.socket, 'room:join', { code });
    await call(guest.socket, 'room:ready', { ready: true });

    const hostView = waitFor<'game:state'>(host.socket, 'game:state');
    const guestView = waitFor<'game:state'>(guest.socket, 'game:state');
    await call(host.socket, 'room:start');
    const [a, b] = (await Promise.all([hostView, guestView])) as GameView[];

    const idle = a.isMyTurn ? { socket: guest.socket, view: b } : { socket: host.socket, view: a };
    await expect(call(idle.socket, 'game:play', { cardId: idle.view.hand[0].id })).rejects.toThrow('還沒輪到你');
  });

  it('一位真人加三個 AI 可以把整局打完並收到結算', async () => {
    const host = await makeClient('人類');
    await call(host.socket, 'room:create', ROOM);
    await call(host.socket, 'room:addAI');
    await call(host.socket, 'room:addAI');
    await call(host.socket, 'room:addAI');

    const over = waitFor<'game:over'>(host.socket, 'game:over', () => true, 40000);

    // 真人玩家用最單純的策略自動打：能出就出，不能出就抽，抽完就結束回合
    host.socket.on('game:state', (view: GameView) => {
      if (view.phase !== 'playing' || !view.isMyTurn) return;
      setTimeout(() => {
        if (view.playableIds.length > 0) {
          const card = view.hand.find((c) => c.id === view.playableIds[0])!;
          void call(host.socket, 'game:play', {
            cardId: card.id,
            chosenColor: card.color === null ? 'red' : undefined,
          }).catch(() => {});
        } else if (view.pendingDraw > 0 || !view.hasDrawnThisTurn) {
          void call(host.socket, 'game:draw').catch(() => {});
        } else {
          void call(host.socket, 'game:pass').catch(() => {});
        }
      }, 10);
    });

    // 剩一張就乖乖喊 UNO
    host.socket.on('game:state', (view: GameView) => {
      if (view.canCallUno) void call(host.socket, 'game:callUno').catch(() => {});
    });

    await call(host.socket, 'room:start');

    const result = (await over) as GameResult;
    expect(result.standings).toHaveLength(4);
    expect(result.standings[0].cardsLeft).toBe(0);
    expect(result.standings.map((s) => s.rank)).toEqual([1, 2, 3, 4]);
    expect(result.durationMs).toBeGreaterThan(0);
  }, 45000);
});

describe('重連', () => {
  it('帶著 sessionToken 重連會回到原本的房間，手牌完整', async () => {
    const host = await makeClient('房主');
    const { code } = await call<{ code: string }>(host.socket, 'room:create', ROOM);
    await call(host.socket, 'room:addAI');

    // 監聽要在 room:start 之前掛上 —— 開局的 game:state 是在 ack 之前送出的
    const firstView = waitFor<'game:state'>(host.socket, 'game:state');
    await call(host.socket, 'room:start');
    const before = (await firstView) as GameView;

    host.socket.disconnect();

    // 用同一個 token 重新連上來
    const revived: ClientSocket = connect(`http://localhost:${port}`, { transports: ['websocket'] });
    clients.push(revived);
    await new Promise<void>((resolve) => revived.on('connect', () => resolve()));

    const roomBack = waitFor<'room:state'>(revived, 'room:state', (r) => r !== null);
    const gameBack = waitFor<'game:state'>(revived, 'game:state');
    await call<Profile>(revived, 'identify', { sessionToken: host.profile.sessionToken });

    const room = (await roomBack) as RoomView;
    const view = (await gameBack) as GameView;

    expect(room.code).toBe(code);
    expect(room.players.find((p) => p.id === host.profile.playerId)?.connected).toBe(true);
    // 重連拿回的是同一副手牌（AI 期間可能被罰抽，所以只檢查原本的牌還在）
    for (const card of before.hand) {
      expect(view.hand.map((c) => c.id)).toContain(card.id);
    }
  });

  it('沒帶 token 就是新玩家，不會撿到別人的座位', async () => {
    const host = await makeClient('房主');
    await call(host.socket, 'room:create', ROOM);

    // 全新連線、不帶 token
    const stranger: ClientSocket = connect(`http://localhost:${port}`, { transports: ['websocket'] });
    clients.push(stranger);
    await new Promise<void>((resolve) => stranger.on('connect', () => resolve()));

    const state = waitFor<'room:state'>(stranger, 'room:state');
    const profile = await call<Profile>(stranger, 'identify', {});

    expect(profile.playerId).not.toBe(host.profile.playerId);
    expect(await state).toBeNull();
    await expect(call(stranger, 'room:leave')).resolves.toBeNull();
  });
});
