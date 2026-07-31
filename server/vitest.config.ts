import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 端對端測試要跑真的 socket 往返，預設 5 秒不夠
    testTimeout: 20_000,
    hookTimeout: 20_000,
    env: {
      // 不然打完一局要等 AI 真的「思考」三十幾秒
      UNO_AI_DELAY_MS: '5',
      UNO_AI_JITTER_MS: '10',
    },
  },
});
