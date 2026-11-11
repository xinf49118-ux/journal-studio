import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {plannerChecks} from './planner_browser_checks.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function workspaceChecks(cdp,check,art){
 console.log('\n[新增功能] 主题素材、模板、作品备份与保存失败');
 const library=JSON.parse(await cdp.eval(`(()=>{
   const select=document.querySelector('#collection-filter');select.value='garden';select.dispatchEvent(new Event('change'));
   const cards=[...document.querySelectorAll('.mat-card')];
   cards[0].querySelector('.favorite-btn').click();
   document.querySelector('.preview-btn').click();
   const preview=document.querySelector('#material-preview').open;document.querySelector('#close-preview').click();
   return JSON.stringify({count:cards.length,height:document.querySelector('.mat-card').getBoundingClientRect().height,preview,favorites:JSON.parse(localStorage.getItem('journal-studio:favorites')).length});
 })()`));
 check('主题筛选48件、卡片不压扁、收藏与大图预览',library.count===48&&library.height>200&&library.preview&&library.favorites===1,JSON.stringify(library));
 await plannerChecks(cdp,check,art);
 await cdp.eval(`document.querySelector('[data-tab="works"]').click()`);await pause(1500);
 check('六套模板预览真实加载',await cdp.eval(`document.querySelectorAll('.template-card img').length===6 && [...document.querySelectorAll('.template-card img')].every(i=>i.naturalWidth>0)`));
 writeFileSync(join(art,'templates-desktop.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await cdp.eval(`document.querySelector('.collage-templates').open=true;document.querySelector('.template-card button').click()`);await pause(1800);
 check('点击模板生成可编辑图层并自动保存',await cdp.eval(`(async()=>{const {state}=await import('./web/js/core.js');return state.layers.length>8 && document.querySelector('#save-status').dataset.status==='saved';})()`));
 // Include a real raster user image in the portable backup.
 await cdp.eval(`(async()=>{
  const {api}=await import('./web/js/api.js');const core=await import('./web/js/core.js');
  const canvas=document.createElement('canvas');canvas.width=80;canvas.height=60;canvas.getContext('2d').fillRect(4,5,30,20);
  const blob=await new Promise(r=>canvas.toBlob(r));const {item}=await api.importBlob(blob,'roundtrip.png');
  await (await import('./web/js/library.js')).loadLibrary();core.state.layers.push(core.makeImageLayer(item));core.emit('changed');
  document.querySelector('[data-tab="works"]').click();document.querySelector('#work-name').value='备份回归作品';
  document.querySelector('#save-new-work').click();
 })()`);await pause(1800);
 const exported=await cdp.eval(`(async()=>{
  const {shelf}=await import('./web/js/backup.js');const all=await shelf('list');
  const record=all.find(x=>x.name==='备份回归作品');return JSON.stringify(record.bundle);
 })()`);
 check('独立作品包含用户图片二进制',JSON.parse(exported).assets[0]?.data.startsWith('data:image/png;base64,'));
 // Empty the isolated browser's library and draft to simulate another device.
 await cdp.eval(`(async()=>{
  await (await import('./web/js/store.js')).store.clear();localStorage.removeItem('journal-studio:project');
 })()`);
 await cdp.send('Page.reload',{ignoreCache:true});await pause(4000);
 await cdp.eval(`(()=>{
  document.querySelector('[data-tab="works"]').click();
  const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(exported)}],'portable.journal.json',{type:'application/json'}));
  const input=document.querySelector('#backup-file');input.files=dt.files;input.dispatchEvent(new Event('change'));
 })()`);await pause(2000);
 check('空素材库通过文件导入恢复图片和图层',await cdp.eval(`(async()=>{
  const {state}=await import('./web/js/core.js');return state.layers.length>8 && state.library.length===1 && state.layers.some(l=>l.kind==='image'&&l.ref===state.library[0].id);
 })()`));
 await cdp.eval(`(()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError')};document.querySelector('#btn-save-project').click();})()`);
 // Change before forcing save because an unchanged successful payload needs no storage write.
 await cdp.eval(`(async()=>{const c=await import('./web/js/core.js');c.state.layers[0].x_mm+=1;c.emit('changed');document.querySelector('#btn-save-project').click();})()`);await pause(800);
 check('配额不足时显示失败而非保存成功',await cdp.eval(`document.querySelector('#save-status').dataset.status==='error'`));
 await cdp.eval(`Storage.prototype.setItem=window.originalSet;document.querySelector('#btn-save-project').click()`);await pause(800);
 check('相同内容保存失败后可以重试成功',await cdp.eval(`document.querySelector('#save-status').dataset.status==='saved'`));
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await cdp.eval(`document.querySelector('[data-tab="works"]').click()`);await pause(600);
 check('390px手机模板页没有横向溢出',await cdp.eval(`document.documentElement.scrollWidth<=window.innerWidth+1`));
 writeFileSync(join(art,'templates-mobile.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
 await cdp.eval(`document.querySelector('[data-tab="library"]').click();document.querySelector('#collection-filter').value='cats';document.querySelector('#collection-filter').dispatchEvent(new Event('change'))`);await pause(600);
 check('390px手机素材页没有横向溢出',await cdp.eval(`document.documentElement.scrollWidth<=window.innerWidth+1`));
 await cdp.send('Emulation.clearDeviceMetricsOverride');
 await cdp.eval(`document.querySelector('#collection-filter').value='';document.querySelector('#collection-filter').dispatchEvent(new Event('change'))`);
}
