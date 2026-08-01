/**
 * 房間登錄與房間本體。
 *
 * 狀態全部放記憶體 —— 這類即時對戰不需要持久化，Render 重啟清空是可接受的取捨。
 */
import bcrypt from 'bcryptjs';
import {
  FELTS,
  type AvatarId,
  type ChatMessage,
  type FeltId,
  type RoomOptions,
  type RoomPhase,
  type RoomPlayer,
  type RoomSummary,
  type RoomView,
} from '@uno/shared';
import { GameEngine, type PlayerMeta } from './game.ts';
import { aiNickname, randomAvatar } from './nicknames.ts';

/** 真人斷線後保留座位的時間；超過就交給 AI 接手 */
export const DISCONNECT_GRACE_MS = 60_000;
/** 還在房間等待階段時的斷線寬限；主要是讓「重新整理」不會被踢出房間 */
export const LOBBY_GRACE_MS = 20_000;
const CHAT_HISTORY = 60;
const ROOM_IDLE_MS = 30 * 60_000;

export interface Player {
  id: string;
  nickname: string;
  avatar: AvatarId;
  isAI: boolean;
  isReady: boolean;
  connected: boolean;
  aiTakeover: boolean;
  socketId: string | null;
  /** 斷線寬限倒數 */
  graceTimer: ReturnType<typeof setTimeout> | null;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉容易看錯的 I/O/0/1

export class Room {
  readonly code: string;
  options: RoomOptions;
  passwordHash: string | null;
  hostId: string;
  players: Player[] = [];
  chat: ChatMessage[] = [];
  phase: RoomPhase = 'lobby';
  game: GameEngine | null = null;
  lastActivity = Date.now();

  constructor(code: string, options: RoomOptions, passwordHash: string | null, hostId: string) {
    this.code = code;
    this.options = options;
    this.passwordHash = passwordHash;
    this.hostId = hostId;
  }

  // ------------------------------------------------------------- 玩家管理

  find(playerId: string): Player | undefined {
    return this.players.find((p) => p.id === playerId);
  }

  get humans(): Player[] {
    return this.players.filter((p) => !p.isAI);
  }

  get isFull(): boolean {
    return this.players.length >= this.options.maxPlayers;
  }

  add(player: Player): void {
    this.players.push(player);
    this.touch();
  }

  remove(playerId: string): void {
    const p = this.find(playerId);
    if (p?.graceTimer) clearTimeout(p.graceTimer);
    this.players = this.players.filter((x) => x.id !== playerId);

    if (this.hostId === playerId) {
      // 房主讓給下一位真人；全是 AI 就沒有房主
      this.hostId = this.humans[0]?.id ?? '';
    }
    this.touch();
  }

  addAI(): Player | null {
    if (this.isFull) return null;
    const taken = new Set(this.players.map((p) => p.nickname));
    const player: Player = {
      id: `ai_${Math.random().toString(36).slice(2, 10)}`,
      nickname: aiNickname(taken),
      avatar: randomAvatar(),
      isAI: true,
      isReady: true, // AI 永遠是準備好的
      connected: true,
      aiTakeover: false,
      socketId: null,
      graceTimer: null,
    };
    this.add(player);
    return player;
  }

  /** 除了房主以外都準備好，且人數 >= 2，才能開始 */
  get canStart(): boolean {
    if (this.players.length < 2) return false;
    return this.players.every((p) => p.id === this.hostId || p.isReady);
  }

  touch(): void {
    this.lastActivity = Date.now();
  }

  get isStale(): boolean {
    return this.humans.length === 0 && Date.now() - this.lastActivity > ROOM_IDLE_MS;
  }

  // ---------------------------------------------------------------- 聊天

  pushChat(message: ChatMessage): void {
    this.chat.push(message);
    if (this.chat.length > CHAT_HISTORY) this.chat = this.chat.slice(-CHAT_HISTORY);
    this.touch();
  }

  system(text: string): ChatMessage {
    const message: ChatMessage = {
      id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      kind: 'system',
      playerId: null,
      nickname: null,
      avatar: null,
      text,
      at: Date.now(),
    };
    this.pushChat(message);
    return message;
  }

  // ------------------------------------------------------------------ 視角

  metaOf(playerId: string): PlayerMeta {
    const p = this.find(playerId);
    if (!p) {
      return { nickname: '（已離開）', avatar: 'robot', isAI: true, connected: false, aiTakeover: true };
    }
    return {
      nickname: p.nickname,
      avatar: p.avatar,
      isAI: p.isAI,
      connected: p.connected,
      aiTakeover: p.aiTakeover,
    };
  }

  view(): RoomView {
    return {
      code: this.code,
      options: this.options,
      phase: this.phase,
      hostId: this.hostId,
      players: this.players.map(
        (p): RoomPlayer => ({
          id: p.id,
          nickname: p.nickname,
          avatar: p.avatar,
          isHost: p.id === this.hostId,
          isAI: p.isAI,
          isReady: p.isReady,
          connected: p.connected,
          aiTakeover: p.aiTakeover,
        }),
      ),
    };
  }

  summary(): RoomSummary {
    return {
      code: this.code,
      name: this.options.name,
      hasPassword: this.passwordHash !== null,
      playerCount: this.players.length,
      maxPlayers: this.options.maxPlayers,
      phase: this.phase,
    };
  }
}

// ------------------------------------------------------------------ 登錄表

class RoomRegistry {
  private rooms = new Map<string, Room>();

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  create(options: RoomOptions, password: string | undefined, hostId: string): Room {
    const code = this.newCode();
    const hash = password ? bcrypt.hashSync(password, 8) : null;
    const room = new Room(code, { ...options, hasPassword: hash !== null }, hash, hostId);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  destroy(code: string): void {
    const room = this.rooms.get(code);
    room?.game?.dispose();
    for (const p of room?.players ?? []) if (p.graceTimer) clearTimeout(p.graceTimer);
    this.rooms.delete(code);
  }

  /** 大廳清單只給公開、還沒開打、也還沒滿的房間 */
  publicList(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((r) => r.options.isPublic && r.phase === 'lobby' && !r.isFull)
      .sort((a, b) => b.lastActivity - a.lastActivity)
      .slice(0, 30)
      .map((r) => r.summary());
  }

  /** 找一間可以直接跳進去的公開房（「開始遊戲」用） */
  findJoinable(): Room | undefined {
    return [...this.rooms.values()]
      .filter((r) => r.options.isPublic && r.phase === 'lobby' && !r.isFull && r.passwordHash === null)
      .sort((a, b) => b.players.length - a.players.length)[0];
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }

  /** 定期清掉沒人的空房 */
  sweep(): string[] {
    const removed: string[] = [];
    for (const room of this.rooms.values()) {
      if (room.isStale) {
        this.destroy(room.code);
        removed.push(room.code);
      }
    }
    return removed;
  }
}

export const rooms = new RoomRegistry();

export function verifyPassword(room: Room, password: string | undefined): boolean {
  if (!room.passwordHash) return true;
  if (!password) return false;
  return bcrypt.compareSync(password, room.passwordHash);
}

export function normalizeOptions(input: {
  name?: unknown;
  maxPlayers?: unknown;
  allowAI?: unknown;
  isPublic?: unknown;
  stacking?: unknown;
  felt?: unknown;
}): RoomOptions {
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 16) : '快樂 UNO 房';
  const maxPlayers = Math.min(4, Math.max(2, Number(input.maxPlayers) || 4));
  const felt = FELTS.includes(input.felt as FeltId) ? (input.felt as FeltId) : 'violet';
  return {
    name,
    hasPassword: false, // 由 registry.create 依實際密碼覆寫
    maxPlayers,
    allowAI: input.allowAI !== false,
    isPublic: input.isPublic !== false,
    stacking: input.stacking === true,
    felt,
  };
}
