/** 註冊 CSS import 忽略 hook（給 tools/ 預覽腳本用）。 */
import { register } from 'node:module';
register('./css-stub-loader.mjs', import.meta.url);
