/** 遊戲 / 房間狀態型別。伺服器持有完整狀態，前端只拿到裁切後的 PlayerView。 */
import type { Card, CardColor } from './cards.ts';

export const AVATARS = [
  'boy', 'girl', 'shiba', 'cat',
  'penguin', 'dino', 'bear', 'rabbit',
  'headset', 'robot', 'frog', 'chick',
] as const;
export type AvatarId = (typeof AVATARS)[number];

export const FELTS = ['violet', 'green', 'blue', 'pink', 'wood'] as const;
export type FeltId = (typeof FELTS)[number];

// ------------------------------------------------------------------ 房間

export interface RoomOptions {
  name: string;
  hasPassword: boolean;
  maxPlayers: number; // 2–4
  allowAI: boolean;
  isPublic: boolean;
  /** +2 / +4 可疊加給下家（非經典規則，預設關閉） */
  stacking: boolean;
  felt: FeltId;
}

export interface RoomPlayer {
  id: string;
  nickname: string;
  avatar: AvatarId;
  isHost: boolean;
  isAI: boolean;
  isReady: boolean;
  connected: boolean;
  /** 真人離線後由 AI 代打中 */
  aiTakeover: boolean;
}

export type RoomPhase = 'lobby' | 'playing' | 'finished';

export interface RoomSummary {
  code: string;
  name: string;
  hasPassword: boolean;
  playerCount: number;
  maxPlayers: number;
  phase: RoomPhase;
}

export interface RoomView {
  code: string;
  options: RoomOptions;
  phase: RoomPhase;
  players: RoomPlayer[];
  hostId: string;
}

// ------------------------------------------------------------------ 對局

/** 選色不是伺服器階段 —— 前端在送出 game:play 前就先選好顏色一起帶上 */
export type GamePhase = 'playing' | 'finished';

export interface OpponentView {
  id: string;
  nickname: string;
  avatar: AvatarId;
  isAI: boolean;
  connected: boolean;
  aiTakeover: boolean;
  handCount: number;
  /** 已在緩衝時間內喊過 UNO */
  saidUno: boolean;
  /** 可被抓 UNO（緩衝已過、只剩一張、未喊） */
  catchable: boolean;
}

/** UNO 緩衝倒數。只有 playerId 本人能在 deadline 前喊。 */
export interface UnoWindow {
  playerId: string;
  /** epoch ms；到期後其他玩家才可抓 */
  deadline: number;
}

export interface GameView {
  phase: GamePhase;
  /** 依座位順序，從自己的下一位開始（前端環繞排版用） */
  opponents: OpponentView[];
  hand: Card[];
  /** 手上哪些牌現在可出（前端提示用，伺服器仍會再驗一次） */
  playableIds: string[];
  discardTop: Card | null;
  /** 目前生效顏色（出 wild 後為選定色） */
  activeColor: CardColor | null;
  drawPileCount: number;
  discardPileCount: number;
  currentPlayerId: string;
  nextPlayerId: string;
  direction: 1 | -1;
  /** 自己是否為當前玩家 */
  isMyTurn: boolean;
  /** 本回合已抽過牌，只能出該牌或結束回合 */
  hasDrawnThisTurn: boolean;
  /** 疊加中的待抽張數（stacking 開啟時） */
  pendingDraw: number;
  unoWindow: UnoWindow | null;
  /** 自己是否可以喊 UNO（緩衝內、剩一張、還沒喊） */
  canCallUno: boolean;
  /** 自己現在可以抓的對手 id */
  catchableIds: string[];
  turnDeadline: number | null;
  startedAt: number;
}

// ------------------------------------------------------------------ 結算

export interface Standing {
  playerId: string;
  nickname: string;
  avatar: AvatarId;
  isAI: boolean;
  rank: number;
  cardsLeft: number;
  /** 依剩餘牌面計分，越低越好 */
  penalty: number;
}

export interface GameResult {
  winnerId: string;
  winnerNickname: string;
  standings: Standing[];
  /** 毫秒 */
  durationMs: number;
}

// ------------------------------------------------------------------ 聊天

export type ChatKind = 'player' | 'system';

export interface ChatMessage {
  id: string;
  kind: ChatKind;
  /** system 訊息為 null */
  playerId: string | null;
  nickname: string | null;
  avatar: AvatarId | null;
  text: string;
  at: number;
}

/** 遊戲中飄在頭像旁的表情泡泡 */
export interface EmoteEvent {
  playerId: string;
  emote: string;
  at: number;
}
