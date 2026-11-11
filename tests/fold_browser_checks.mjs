import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function foldChecks(cdp,check,art){
 const before=await cdp.eval(`(async()=>JSON.stringify((await import('./web/js/core.js')).serializeProject()))()`);
 await cdp.eval(`document.querySelector('[data-tab="coverage"]').click();document.querySelector('#coverage-clear').click();document.querySelector('#coverage-search').value='常规 032';document.querySelector('#coverage-search').dispatchEvent(new Event('input'));document.querySelector('.coverage-card button').click()`);await pause(600);
 check('核查入口能打开实际尺寸折页预览',await cdp.eval(`document.querySelector('#fold-builder').open&&document.querySelector('#fold-preview').naturalWidth>0&&!document.querySelector('#fold-export').disabled`));
 for(const size of ['regular','passport']){
  await cdp.eval(`document.querySelector('#fold-size').value=${JSON.stringify(size)};document.querySelector('#fold-panels').value='3';document.querySelector('#fold-size').dispatchEvent(new Event('change',{bubbles:true}));window.__foldResult=null;window.__foldOldClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download.endsWith('.pdf'))fetch(this.href).then(r=>r.arrayBuffer()).then(a=>{const t=new TextDecoder('latin1').decode(a);window.__foldResult={bytes:a.byteLength,pages:Number(t.match(new RegExp('/Count ([0-9]+)'))?.[1]||0),a4:t.includes('/MediaBox [0 0 595.2756 841.8898]'),base64:btoa(Array.from(new Uint8Array(a),x=>String.fromCharCode(x)).join(''))};});else window.__foldOldClick.call(this);}`);await pause(400);
  await cdp.eval(`document.querySelector('#fold-export').click()`);
  let result;for(let i=0;i<30;i++){await pause(300);result=await cdp.eval('window.__foldResult');if(result)break;}
  await cdp.eval(`HTMLAnchorElement.prototype.click=window.__foldOldClick`);
  check(`${size} 折页通过真实按钮导出多页PDF且尺寸为A4`,!!result&&result.bytes>10000&&result.a4&&result.pages===(size==='regular'?3:2)&&await cdp.eval(`!document.querySelector('#fold-size').disabled&&!document.querySelector('#fold-export').disabled&&document.querySelector('#fold-status').textContent.includes('已导出')`));
  if(result)writeFileSync(join(art,'fold-'+size+'.pdf'),Buffer.from(result.base64,'base64'));
  const shot=await cdp.eval(`(async()=>{const {foldSheets}=await import('./web/js/fold.js'),{renderToPngBlob}=await import('./web/js/render.js');const p=foldSheets({size:${JSON.stringify(size)},panels:3})[0];const b=await renderToPngBlob({...p,page:{...p.page,dpi:85}});return await new Promise(res=>{const f=new FileReader();f.onload=()=>res(f.result.split(',')[1]);f.readAsDataURL(b)});})()`);
  writeFileSync(join(art,'fold-'+size+'.png'),Buffer.from(shot,'base64'));
 }
 check('折页预览与导出不覆盖正在编辑的作品',(await cdp.eval(`(async()=>JSON.stringify((await import('./web/js/core.js')).serializeProject()))()`))===before);
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await pause(250);
 check('折页工具在390px手机没有横向溢出',await cdp.eval('document.documentElement.scrollWidth<=innerWidth+1'));
 await cdp.send('Emulation.clearDeviceMetricsOverride');
 await cdp.eval(`document.querySelector('#fold-builder').open=false`);
}
