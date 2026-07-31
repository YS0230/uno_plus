/** Socket 事件路由：大廳、房間、聊天、對局，以及斷線重連／AI 接手。 */
import type { Server, Socket } from 'socket.io';
import {
  AVATARS,
  type Ack,
  type AvatarId,
  type ChatMessage,
  type ClientToServerEvents,
  type GameFeedEvent,
  type GameResult,
  type Profile,
  type ServerToClientEvents,
} from '@uno/shared';
import { GameEngine } from './game.ts';
import { DISCONNECT_GRACE_MS, Room, normalizeOptions, rooms, verifyPassword, type Player } from './rooms.ts';
import { resolveSession, sessionOfPlayer, sweepSessions, type Session } from './sessions.ts';
import { sanitizeNickname } from './nicknames.ts';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;

interface SocketData {
  session: Session;
}

const socketData = new WeakMap<Sock, SocketData>();
/** 訂閱大廳清單的 socket（在大廳頁面才收推播） */
const lobbyWatchers = new Set<string>();

const ok = <T>(ack: Ack<T> | undefined, data: T) => ack?.({ ok: true, data });
const fail = (ack: Ack<never> | undefined, error: string) => ack?.({ ok: false, error });

const messageId = () => `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export function registerHandlers(io: IO): void {
  // ------------------------------------------------------------ 廣播工具

  const pushLobby = () => {
    const list = rooms.publicList();
    for (const id of lobbyWatchers) io.to(id).emit('lobby:rooms', list);
  };

  const pushRoom = (room: Room) => {
    io.to(room.code).emit('room:state', room.view());
  };

  /** 每位玩家各自一份裁切過的視角 */
  const pushGame = (room: Room) => {
    if (!room.game) return;
    for (const p of room.players) {
      if (!p.socketId) continue;
      io.to(p.socketId).emit('game:state', room.game.viewFor(p.id));
    }
  };

  const say = (room: Room, message: ChatMessage) => {
    room.pushChat(message);
    io.to(room.code).emit('chat:message', message);
  };

  const systemSay = (room: Room, text: string) => {
    io.to(room.code).emit('chat:message', room.system(text));
  };

  // ---------------------------------------------------------------- 對局

  const startGame = (room: Room) => {
    room.game?.dispose();
    room.phase = 'playing';
    for (const p of room.players) if (!p.isAI) p.isReady = false;

    room.game = new GameEngine(
      room.players.map((p) => p.id),
      { stacking: room.options.stacking },
      {
        metaOf: (id) => room.metaOf(id),
        emitState: () => pushGame(room),
        feed: (event: GameFeedEvent) => io.to(room.code).emit('game:feed', event),
        unoCalled: (playerId) => {
          io.to(room.code).emit('uno:called', { playerId, nickname: room.metaOf(playerId).nickname });
        },
        unoCaught: (catcherId, caughtId) => {
          const catcher = room.metaOf(catcherId);
          const caught = room.metaOf(caughtId);
          io.to(room.code).emit('uno:caught', {
            catcherId,
            catcherName: catcher.nickname,
            caughtId,
            caughtName: caught.nickname,
            caughtAvatar: caught.avatar,
          });
          systemSay(room, `${catcher.nickname} 抓到了 ${caught.nickname} 未喊 UNO，罰抽兩張！`);
        },
        finished: (result: GameResult) => {
          room.phase = 'finished';
          io.to(room.code).emit('game:over', result);
          systemSay(room, `${result.winnerNickname} 獲勝！`);
          pushRoom(room);
          pushLobby();
        },
      },
    );

    systemSay(room, '遊戲開始！');
    pushRoom(room);
    pushGame(room);
    pushLobby();
  };

  // ------------------------------------------------------- 離開 / 斷線

  const leaveRoom = (session: Session, opts: { announce?: boolean } = {}) => {
    const room = session.roomCode ? rooms.get(session.roomCode) : undefined;
    session.roomCode = null;
    if (!room) return;

    const player = room.find(session.playerId);
    if (!player) return;

    if (opts.announce !== false) systemSay(room, `${player.nickname} 離開了房間`);
    room.remove(session.playerId);

    if (room.game && !room.game.isFinished) room.game.removeSeat(session.playerId);

    if (room.humans.length === 0) {
      rooms.destroy(room.code);
    } else {
      room.phase = room.game && !room.game.isFinished ? room.phase : 'lobby';
      pushRoom(room);
      pushGame(room);
    }
    pushLobby();
  };

  /** 寬限期滿：座位交給 AI，遊戲繼續 */
  const handOverToAI = (room: Room, player: Player) => {
    if (player.connected) return;
    player.aiTakeover = true;
    player.isReady = true;
    systemSay(room, `${player.nickname} 離線太久，交由 AI 接手`);
    pushRoom(room);
    pushGame(room);
    room.game?.nudgeAI();
  };

  const onDisconnect = (session: Session) => {
    const room = session.roomCode ? rooms.get(session.roomCode) : undefined;
    if (!room) return;
    const player = room.find(session.playerId);
    if (!player) return;

    player.connected = false;
    player.socketId = null;

    // 還沒開打就直接讓出座位，不用佔著
    if (room.phase === 'lobby') {
      leaveRoom(session);
      return;
    }

    systemSay(room, `${player.nickname} 斷線了，${DISCONNECT_GRACE_MS / 1000} 秒內可重連`);
    pushRoom(room);
    pushGame(room);

    if (player.graceTimer) clearTimeout(player.graceTimer);
    player.graceTimer = setTimeout(() => {
      player.graceTimer = null;
      handOverToAI(room, player);
    }, DISCONNECT_GRACE_MS);
  };

  /** 重連：找回座位，並把控制權從 AI 收回來 */
  const rejoin = (socket: Sock, session: Session): Room | null => {
    const room = session.roomCode ? rooms.get(session.roomCode) : undefined;
    if (!room) {
      session.roomCode = null;
      return null;
    }
    const player = room.find(session.playerId);
    if (!player) {
      session.roomCode = null;
      return null;
    }

    if (player.graceTimer) {
      clearTimeout(player.graceTimer);
      player.graceTimer = null;
    }
    const wasAway = !player.connected;
    player.connected = true;
    player.aiTakeover = false;
    player.socketId = socket.id;
    socket.join(room.code);

    if (wasAway) systemSay(room, `${player.nickname} 回來了`);
    return room;
  };

  // ------------------------------------------------------------- 連線

  io.on('connection', (socket: Sock) => {
    socket.on('identify', (input, ack) => {
      const session = resolveSession(input?.sessionToken);
      socketData.set(socket, { session });

      const nickname = sanitizeNickname(input?.nickname);
      if (nickname) session.nickname = nickname;
      if (input?.avatar && AVATARS.includes(input.avatar)) session.avatar = input.avatar;

      const profile: Profile = {
        playerId: session.playerId,
        sessionToken: session.token,
        nickname: session.nickname,
        avatar: session.avatar,
      };
      ok(ack, profile);
      socket.emit('session', profile);

      // 帶著 token 回來的話，直接把他放回原本的房間
      const room = rejoin(socket, session);
      if (room) {
        const player = room.find(session.playerId);
        if (player) {
          player.nickname = session.nickname;
          player.avatar = session.avatar;
        }
        socket.emit('room:state', room.view());
        socket.emit('chat:history', room.chat);
        pushRoom(room);
        pushGame(room);
      } else {
        socket.emit('room:state', null);
      }
    });

    const ctx = () => socketData.get(socket)?.session;

    /** 取出「目前在房間裡」的上下文，順便擋掉還沒 identify 的請求 */
    const inRoom = (ack?: Ack<never>): { session: Session; room: Room; player: Player } | null => {
      const session = ctx();
      if (!session) { fail(ack, '尚未建立連線身分'); return null; }
      const room = session.roomCode ? rooms.get(session.roomCode) : undefined;
      if (!room) { fail(ack, '你不在任何房間裡'); return null; }
      const player = room.find(session.playerId);
      if (!player) { fail(ack, '你不在這個房間裡'); return null; }
      return { session, room, player };
    };

    // ------------------------------------------------------------ 個人資料

    socket.on('profile:update', (input, ack) => {
      const session = ctx();
      if (!session) return fail(ack, '尚未建立連線身分');

      const nickname = sanitizeNickname(input?.nickname);
      if (!nickname) return fail(ack, '暱稱不能空白');
      session.nickname = nickname;
      if (input?.avatar && AVATARS.includes(input.avatar)) session.avatar = input.avatar;

      const room = session.roomCode ? rooms.get(session.roomCode) : undefined;
      const player = room?.find(session.playerId);
      if (room && player) {
        player.nickname = session.nickname;
        player.avatar = session.avatar;
        pushRoom(room);
        pushGame(room);
      }

      ok(ack, {
        playerId: session.playerId,
        sessionToken: session.token,
        nickname: session.nickname,
        avatar: session.avatar,
      });
    });

    // ---------------------------------------------------------------- 大廳

    socket.on('lobby:subscribe', (input) => {
      if (input?.on) {
        lobbyWatchers.add(socket.id);
        socket.emit('lobby:rooms', rooms.publicList());
      } else {
        lobbyWatchers.delete(socket.id);
      }
    });

    socket.on('lobby:list', (ack) => ok(ack, rooms.publicList()));

    // ---------------------------------------------------------------- 房間

    const joinRoom = (session: Session, room: Room): string | null => {
      if (room.find(session.playerId)) return null; // 已經在裡面
      if (room.isFull) return '房間已滿';
      if (room.phase !== 'lobby') return '這場遊戲已經開始了';

      const player: Player = {
        id: session.playerId,
        nickname: session.nickname,
        avatar: session.avatar,
        isAI: false,
        isReady: false,
        connected: true,
        aiTakeover: false,
        socketId: socket.id,
        graceTimer: null,
      };
      room.add(player);
      session.roomCode = room.code;
      socket.join(room.code);
      return null;
    };

    socket.on('room:create', (input, ack) => {
      const session = ctx();
      if (!session) return fail(ack, '尚未建立連線身分');
      if (session.roomCode) leaveRoom(session);

      const password = typeof input?.password === 'string' && input.password.trim() ? input.password.trim() : undefined;
      const room = rooms.create(normalizeOptions(input ?? {}), password, session.playerId);

      const error = joinRoom(session, room);
      if (error) { rooms.destroy(room.code); return fail(ack, error); }

      systemSay(room, `${session.nickname} 建立了房間`);
      ok(ack, { code: room.code });
      socket.emit('room:state', room.view());
      socket.emit('chat:history', room.chat);
      pushLobby();
    });

    socket.on('room:join', (input, ack) => {
      const session = ctx();
      if (!session) return fail(ack, '尚未建立連線身分');

      const code = String(input?.code ?? '').trim().toUpperCase();
      // 空房號＝「開始遊戲」快速配對
      const room = code ? rooms.get(code) : rooms.findJoinable();
      if (!room) return fail(ack, code ? '找不到這個房間' : '目前沒有可加入的房間，建一間吧');
      if (!verifyPassword(room, input?.password)) return fail(ack, '房間密碼不正確');

      if (session.roomCode && session.roomCode !== room.code) leaveRoom(session);

      const error = joinRoom(session, room);
      if (error) return fail(ack, error);

      systemSay(room, `${session.nickname} 加入了房間`);
      ok(ack, { code: room.code });
      socket.emit('chat:history', room.chat);
      pushRoom(room);
      pushLobby();
    });

    socket.on('room:leave', (ack) => {
      const session = ctx();
      if (!session) return fail(ack, '尚未建立連線身分');
      const code = session.roomCode;
      leaveRoom(session);
      if (code) socket.leave(code);
      socket.emit('room:state', null);
      ok(ack, null);
    });

    socket.on('room:ready', (input, ack) => {
      const found = inRoom(ack);
      if (!found) return;
      const { room, player } = found;
      if (room.phase !== 'lobby') return fail(ack, '遊戲進行中不能改準備狀態');

      player.isReady = Boolean(input?.ready);
      systemSay(room, `${player.nickname} ${player.isReady ? '已準備' : '取消準備'}`);
      pushRoom(room);
      ok(ack, null);
    });

    socket.on('room:kick', (input, ack) => {
      const found = inRoom(ack);
      if (!found) return;
      const { room, player } = found;
      if (player.id !== room.hostId) return fail(ack, '只有房主可以踢人');

      const target = room.find(String(input?.playerId ?? ''));
      if (!target) return fail(ack, '找不到這位玩家');
      if (target.id === room.hostId) return fail(ack, '不能踢自己');

      systemSay(room, `${target.nickname} 被房主請出房間`);
      if (target.socketId) {
        io.to(target.socketId).emit('kicked', { reason: '你被房主請出房間了' });
        io.to(target.socketId).emit('room:state', null);
        io.sockets.sockets.get(target.socketId)?.leave(room.code);
      }
      const targetSession = sessionOfPlayer(target.id);
      if (targetSession) targetSession.roomCode = null;

      room.remove(target.id);
      if (room.game && !room.game.isFinished) room.game.removeSeat(target.id);
      pushRoom(room);
      pushGame(room);
      pushLobby();
      ok(ack, null);
    });

    socket.on('room:addAI', (ack) => {
      const found = inRoom(ack);
      if (!found) return;
      const { room, player } = found;
      if (player.id !== room.hostId) return fail(ack, '只有房主可以新增 AI');
      if (!room.options.allowAI) return fail(ack, '這個房間不允許 AI 玩家');
      if (room.phase !== 'lobby') return fail(ack, '遊戲進行中不能加人');

      const ai = room.addAI();
      if (!ai) return fail(ack, '房間已滿');

      systemSay(room, `${ai.nickname} 加入了房間`);
      pushRoom(room);
      pushLobby();
      ok(ack, null);
    });

    socket.on('room:removeAI', (input, ack) => {
      const found = inRoom(ack);
      if (!found) return;
      const { room, player } = found;
      if (player.id !== room.hostId) return fail(ack, '只有房主可以移除 AI');
      if (room.phase !== 'lobby') return fail(ack, '遊戲進行中不能移除玩家');

      const target = room.find(String(input?.playerId ?? ''));
      if (!target?.isAI) return fail(ack, '找不到這位 AI 玩家');

      room.remove(target.id);
      systemSay(room, `${target.nickname} 離開了房間`);
      pushRoom(room);
      pushLobby();
      ok(ack, null);
    });

    socket.on('room:start', (ack) => {
      const found = inRoom(ack);
      if (!found) return;
      const { room, player } = found;
      if (player.id !== room.hostId) return fail(ack, '只有房主可以開始遊戲');
      if (room.phase === 'playing') return fail(ack, '遊戲已經開始了');
      if (room.players.length < 2) return fail(ack, '至少要兩位玩家才能開始');
      if (!room.canStart) return fail(ack, '還有玩家沒有準備');

      startGame(room);
      ok(ack, null);
    });

    socket.on('room:rematch', (ack) => {
      const found = inRoom(ack);
      if (!found) return;
      const { room, player } = found;
      if (player.id !== room.hostId) return fail(ack, '只有房主可以再開一局');
      if (room.players.length < 2) return fail(ack, '至少要兩位玩家才能開始');

      startGame(room);
      ok(ack, null);
    });

    // ---------------------------------------------------------------- 對局

    /** 對局動作的共同前置：必須在房間裡且遊戲進行中 */
    const inGame = (ack?: Ack<never>) => {
      const found = inRoom(ack);
      if (!found) return null;
      if (!found.room.game || found.room.game.isFinished) { fail(ack, '目前沒有進行中的遊戲'); return null; }
      return { ...found, game: found.room.game };
    };

    socket.on('game:play', (input, ack) => {
      const found = inGame(ack);
      if (!found) return;
      const error = found.game.play(found.player.id, String(input?.cardId ?? ''), input?.chosenColor);
      return error ? fail(ack, error) : ok(ack, null);
    });

    socket.on('game:draw', (ack) => {
      const found = inGame(ack);
      if (!found) return;
      const error = found.game.draw(found.player.id);
      return error ? fail(ack, error) : ok(ack, null);
    });

    socket.on('game:pass', (ack) => {
      const found = inGame(ack);
      if (!found) return;
      const error = found.game.pass(found.player.id);
      return error ? fail(ack, error) : ok(ack, null);
    });

    socket.on('game:callUno', (ack) => {
      const found = inGame(ack);
      if (!found) return;
      const error = found.game.callUno(found.player.id);
      return error ? fail(ack, error) : ok(ack, null);
    });

    socket.on('game:catchUno', (input, ack) => {
      const found = inGame(ack);
      if (!found) return;
      const error = found.game.catchUno(found.player.id, String(input?.targetId ?? ''));
      return error ? fail(ack, error) : ok(ack, null);
    });

    // ---------------------------------------------------------------- 聊天

    socket.on('chat:send', (input, ack) => {
      const found = inRoom(ack);
      if (!found) return;
      const text = String(input?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!text) return fail(ack, '訊息不能空白');

      say(found.room, {
        id: messageId(),
        kind: 'player',
        playerId: found.player.id,
        nickname: found.player.nickname,
        avatar: found.player.avatar,
        text,
        at: Date.now(),
      });
      ok(ack, null);
    });

    socket.on('chat:emote', (input, ack) => {
      const found = inRoom(ack);
      if (!found) return;
      const emote = String(input?.emote ?? '').slice(0, 8);
      if (!emote) return fail(ack, '缺少表情');

      io.to(found.room.code).emit('chat:emote', {
        playerId: found.player.id,
        emote,
        at: Date.now(),
      });
      ok(ack, null);
    });

    // ---------------------------------------------------------------- 斷線

    socket.on('disconnect', () => {
      lobbyWatchers.delete(socket.id);
      const session = ctx();
      if (session) onDisconnect(session);
      pushLobby();
    });
  });

  // 定期清空房與過期 session
  setInterval(() => {
    if (rooms.sweep().length > 0) pushLobby();
    sweepSessions();
  }, 60_000).unref();
}

export type { AvatarId };
