import phaserSource from 'phaser/dist/phaser.min.js?raw';
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const script = value => value.replace(/<\/script/gi, '<\\/script');

export function createGameDocument(project, assets, initialLevel = 0, channel = '', standalone = false) {
  // A fresh opaque-origin sandbox. No provider keys, cookies, imports or network.
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>ArcadeX Game</title><style>html,body,#game{margin:0;width:100%;height:100%;overflow:hidden;background:#08151c}canvas{display:block}#failure{position:fixed;inset:20px;color:#ffd1c5;font:16px/1.5 sans-serif;white-space:pre-wrap;z-index:999;pointer-events:none}</style></head><body><div id="game"></div><div id="failure"></div>
<script>
const channel=${json(channel)};
const report=(type,value)=>{${standalone ? '' : "parent.postMessage({source:'arcadex-studio',channel,type,value},'*');"}};
let saved=null;
${standalone ? "try{saved=JSON.parse(localStorage.getItem('arcadex-progress')||'null')}catch{}" : ''}
window.STUDIO={blueprint:${json(project.blueprint)},settings:${json(project.settings)},assets:${json(assets)},initialLevel:${initialLevel},save(value){saved=value;${standalone ? "try{localStorage.setItem('arcadex-progress',JSON.stringify(value))}catch{}" : "report('save',value);"}},load(){return saved;}};
addEventListener('message',e=>{if(e.source===parent&&e.data?.channel===channel&&e.data?.type==='restore-save')saved=e.data.value;});
function failure(value){const message=String(value).slice(0,2000);document.getElementById('failure').textContent=message;report('error',message);}
addEventListener('error',e=>failure(e.message));addEventListener('unhandledrejection',e=>failure(e.reason?.message||e.reason));
report('ready',true);
</script><script>${script(phaserSource)}</script><script>try{${script(project.code || '')}\n}catch(error){failure(error.message)}</script></body></html>`;
}

export async function readDataURL(blob) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
}
export function download(name, body, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
