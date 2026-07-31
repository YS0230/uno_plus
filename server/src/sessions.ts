/**
 * sessionToken ↔ 玩家身分。重連的關鍵：token 存在前端 localStorage，
 * 每次 handshake 帶上來，就能找回原本的 playerId 與座位。
 */
import { randomBytes } from 'node:crypto';
import type { AvatarId } from '@uno/shared';
import { randomAvatar, randomNickname } from './nicknames.ts';

export interface Session {
  token: string;
  playerId: string;
  nickname: string;
  avatar: AvatarId;
  /** 目前所在房間，離開時清掉 */
  roomCode: string | null;
  lastSeen: number;
}

/** 沒有任何活動超過這個時間就回收 session */
const SESSION_TTL_MS = 6 * 60 * 60_000;

const byToken = new Map<string, Session>();
const byPlayerId = new Map<string, Session>();

const newToken = () => randomBytes(24).toString('base64url');

export function resolveSession(token: string | undefined): Session {
  const existing = token ? byToken.get(token) : undefined;
  if (existing) {
    existing.lastSeen = Date.now();
    return existing;
  }

  const session: Session = {
    token: newToken(),
    playerId: `p_${randomBytes(8).toString('hex')}`,
    nickname: randomNickname(),
    avatar: randomAvatar(),
    roomCode: null,
    lastSeen: Date.now(),
  };
  byToken.set(session.token, session);
  byPlayerId.set(session.playerId, session);
  return session;
}

export const sessionOfPlayer = (playerId: string): Session | undefined => byPlayerId.get(playerId);

export function sweepSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const s of byToken.values()) {
    if (s.lastSeen < cutoff && s.roomCode === null) {
      byToken.delete(s.token);
      byPlayerId.delete(s.playerId);
    }
  }
}
