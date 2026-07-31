/** Socket.IO 事件協定。前後端共用型別，避免事件名稱與 payload 走鐘。 */
import type { CardColor } from './cards.ts';
import type {
  AvatarId,
  ChatMessage,
  EmoteEvent,
  FeltId,
  GameResult,
  GameView,
  RoomSummary,
  RoomView,
} from './types.ts';

export interface Profile {
  playerId: string;
  sessionToken: string;
  nickname: string;
  avatar: AvatarId;
}

export type Ack<T> = (res: { ok: true; data: T } | { ok: false; error: string }) => void;

export interface CreateRoomInput {
  name: string;
  password?: string;
  maxPlayers: number;
  allowAI: boolean;
  isPublic: boolean;
  stacking: boolean;
  felt: FeltId;
}

/** 出牌／抽牌後推播給前端播動畫用的事件 */
export type GameFeedEvent =
  | { type: 'played'; playerId: string; nickname: string; cardLabel: string; color: CardColor | null }
  | { type: 'drew'; playerId: string; nickname: string; count: number }
  | { type: 'penalty'; playerId: string; nickname: string; count: number; reason: 'uno' | 'timeout' }
  | { type: 'color'; playerId: string; nickname: string; color: CardColor }
  | { type: 'skipped'; playerId: string; nickname: string }
  | { type: 'reversed'; direction: 1 | -1 };

export interface ClientToServerEvents {
  identify: (
    input: { sessionToken?: string; nickname?: string; avatar?: AvatarId },
    ack: Ack<Profile>,
  ) => void;
  'profile:update': (input: { nickname: string; avatar: AvatarId }, ack: Ack<Profile>) => void;

  'lobby:list': (ack: Ack<RoomSummary[]>) => void;
  'lobby:subscribe': (input: { on: boolean }) => void;

  'room:create': (input: CreateRoomInput, ack: Ack<{ code: string }>) => void;
  'room:join': (input: { code: string; password?: string }, ack: Ack<{ code: string }>) => void;
  'room:leave': (ack: Ack<null>) => void;
  'room:ready': (input: { ready: boolean }, ack: Ack<null>) => void;
  'room:kick': (input: { playerId: string }, ack: Ack<null>) => void;
  'room:addAI': (ack: Ack<null>) => void;
  'room:removeAI': (input: { playerId: string }, ack: Ack<null>) => void;
  'room:start': (ack: Ack<null>) => void;
  'room:rematch': (ack: Ack<null>) => void;

  'game:play': (input: { cardId: string; chosenColor?: CardColor }, ack: Ack<null>) => void;
  'game:draw': (ack: Ack<null>) => void;
  'game:pass': (ack: Ack<null>) => void;
  'game:callUno': (ack: Ack<null>) => void;
  'game:catchUno': (input: { targetId: string }, ack: Ack<null>) => void;

  'chat:send': (input: { text: string }, ack: Ack<null>) => void;
  'chat:emote': (input: { emote: string }, ack: Ack<null>) => void;
}

export interface ServerToClientEvents {
  session: (profile: Profile) => void;
  'lobby:rooms': (rooms: RoomSummary[]) => void;
  /** null 代表已不在任何房間 */
  'room:state': (room: RoomView | null) => void;
  'game:state': (view: GameView) => void;
  'game:feed': (event: GameFeedEvent) => void;
  'game:over': (result: GameResult) => void;

  'uno:called': (input: { playerId: string; nickname: string }) => void;
  'uno:caught': (input: {
    catcherId: string;
    catcherName: string;
    caughtId: string;
    caughtName: string;
    caughtAvatar: AvatarId;
  }) => void;

  'chat:message': (message: ChatMessage) => void;
  'chat:emote': (event: EmoteEvent) => void;
  'chat:history': (messages: ChatMessage[]) => void;

  toast: (input: { kind: 'info' | 'warn' | 'error' | 'success'; text: string }) => void;
  kicked: (input: { reason: string }) => void;
}
