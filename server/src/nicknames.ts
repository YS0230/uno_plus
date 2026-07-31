/** 首次進入自動產生的可愛暱稱。 */
import { AVATARS, type AvatarId } from '@uno/shared';

const ADJECTIVES = [
  '愛睏', '暴躁', '甜甜', '軟綿', '澎澎', '呆萌', '閃亮', '毛茸茸',
  '圓滾滾', '跳跳', '棉花糖', '小恰恰', '嘰嘰喳喳', '慢吞吞', '香香',
  '氣噗噗', '滑溜溜', '亮晶晶', '暖呼呼', '咕嚕咕嚕',
];

const CREATURES = [
  '柴犬', '企鵝', '水獺', '貓貓', '兔兔', '小熊', '青蛙', '恐龍',
  '小雞', '海豹', '倉鼠', '刺蝟', '樹懶', '狐狸', '浣熊', '鴨鴨',
  '無尾熊', '羊駝', '河馬', '章魚',
];

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

export function randomNickname(): string {
  return `${pick(ADJECTIVES)}${pick(CREATURES)}`;
}

export function randomAvatar(): AvatarId {
  return pick(AVATARS);
}

/** AI 玩家用固定前綴，讓玩家一眼看出是電腦 */
export function aiNickname(taken: ReadonlySet<string>): string {
  for (let i = 0; i < 50; i++) {
    const name = `${pick(CREATURES)}機器人`;
    if (!taken.has(name)) return name;
  }
  return `機器人${Math.floor(Math.random() * 1000)}`;
}

/** 暱稱清洗：去除前後空白、限制長度、擋掉空字串 */
export function sanitizeNickname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 12);
}
