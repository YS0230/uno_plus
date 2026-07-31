/** 讓 tsx 在 Node 端跑 .tsx 元件時忽略 `import './x.css'`（僅供 tools/ 的預覽腳本使用）。 */
export function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    return { format: 'module', shortCircuit: true, source: 'export default {}' };
  }
  return nextLoad(url, context);
}
