import { useEffect, useState } from 'react';

/** 與伺服器 game.ts 的 UNO_BUFFER_MS 一致 */
export const UNO_BUFFER_MS = 2000;

/**
 * 依伺服器給的絕對時間戳倒數。
 * 用時間戳而不是「剩餘秒數」，才不會因為網路延遲或分頁休眠而失準。
 */
export function useCountdown(deadline: number | null): number | null {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (deadline === null) {
      setLeft(null);
      return;
    }
    const tick = () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);

  return left;
}
