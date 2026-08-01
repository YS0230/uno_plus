/** Socket.IO client。自動重連交給 socket.io 本身，重連後靠 sessionToken 找回座位。 */
import { io, type Socket } from 'socket.io-client';
import { AVATARS, type Ack, type AvatarId, type ClientToServerEvents, type ServerToClientEvents } from '@uno/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const TOKEN_KEY = 'uno.sessionToken';
const NICK_KEY = 'uno.nickname';
const AVATAR_KEY = 'uno.avatar';

/** 無痕模式／配額滿時 localStorage 會直接丟例外，包起來免得整個 app 掛掉 */
function read(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: string | undefined): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* 存不進去就算了，記憶體裡的狀態還是對的 */
  }
}

export const storage = {
  get token(): string | undefined {
    return read(TOKEN_KEY);
  },
  set token(v: string | undefined) {
    write(TOKEN_KEY, v);
  },
  get nickname(): string | undefined {
    return read(NICK_KEY);
  },
  set nickname(v: string | undefined) {
    write(NICK_KEY, v);
  },
  get avatar(): AvatarId | undefined {
    const saved = read(AVATAR_KEY) as AvatarId | undefined;
    // 版本更新後頭像清單可能改過，擋掉已經不存在的 id
    return saved && AVATARS.includes(saved) ? saved : undefined;
  },
  set avatar(v: AvatarId | undefined) {
    write(AVATAR_KEY, v);
  },
};

export const socket: AppSocket = io({
  autoConnect: false,
  reconnection: true,
  reconnectionDelay: 600,
  reconnectionDelayMax: 5000,
  // Render free tier 冷啟可能要 30 秒，別太早放棄
  reconnectionAttempts: Infinity,
  timeout: 20000,
});

/** 去掉最後一個參數（也就是 ack callback） */
type DropAck<T extends unknown[]> = T extends [...infer Rest, unknown] ? Rest : [];

type EmitArgs<E extends keyof ClientToServerEvents> = DropAck<Parameters<ClientToServerEvents[E]>>;

type EmitResult<E extends keyof ClientToServerEvents> =
  Parameters<ClientToServerEvents[E]> extends [...unknown[], Ack<infer R>] ? R : void;

/** 把 callback 風格的 ack 包成 Promise，失敗時 reject，讓畫面端可以 await */
export function emit<E extends keyof ClientToServerEvents>(
  event: E,
  ...args: EmitArgs<E>
): Promise<EmitResult<E>> {
  return new Promise((resolve, reject) => {
    const ack = (res: { ok: true; data: unknown } | { ok: false; error: string }) => {
      if (res.ok) resolve(res.data as EmitResult<E>);
      else reject(new Error(res.error));
    };
    // socket.io 的型別無法表達「最後一個參數是 ack」，這一步只能放行
    (socket.emit as (e: E, ...a: unknown[]) => void)(event, ...(args as unknown[]), ack);
  });
}
