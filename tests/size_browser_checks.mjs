import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function sizeChecks(cdp,check,art){
 await cdp.eval(`(async()=>{const c=await import('./web/js/core.js'),p=await import('./web/js/planner.js');c.loadProject(p.plannerProject({layout:'monthly',month:'2024-02'},c.state.materials.items));c.emit('changed');document.querySelector('[data-tab="editor"]').click();window.__sizeBefore=c.state.layers.filter(l=>l.kind==='shape').map(l=>({w:l.w_mm,h:l.h_mm}));document.querySelector('#page-size').value='B6';document.querySelector('#page-size').dispatchEvent(new Event('change'));})()`);await pause(500);
 check('编辑器更换B6纸张时图层同比缩放',await cdp.eval(`(async()=>{const c=await import('./web/js/core.js');return c.state.page.size==='B6'&&c.state.layers.filter(l=>l.kind==='shape').every((l,i)=>Math.abs(l.w_mm/window.__sizeBefore[i].w-128/148)<1e-6);})()`));
 await cdp.eval(`document.querySelector('[data-tab="print"]').click();document.querySelector('#print-size').value='A6';document.querySelector('#print-size').dispatchEvent(new Event('change'))`);await pause(400);
 check('打印页更换A6纸张时内容适配，纸张选项同步',await cdp.eval(`(async()=>{const c=await import('./web/js/core.js');return c.state.page.size==='A6'&&document.querySelector('#page-size').value==='A6'&&c.state.layers.filter(l=>l.kind==='shape').every(l=>l.x_mm+l.w_mm<105&&l.y_mm+l.h_mm<148);})()`));
 const resized=await cdp.eval(`(async()=>{const c=await import('./web/js/core.js'),r=await import('./web/js/render.js'),pdf=await import('./web/js/pdf.js'),{fitProject}=await import('./web/js/page-fit.js');const results=[];for(const size of ['A5','A6','B6','Weeks']){const p=fitProject(c.serializeProject(),size),j=await r.renderToJpeg(p),[w,h]=c.PAGE_SIZES[size],data=pdf.buildPdf([j],{pageWmm:w,pageHmm:h});results.push({size,pixels:[j.width,j.height],expected:[Math.round(w*300/25.4),Math.round(h*300/25.4)],bytes:data.length});}return results;})()`);
 check('四种尺寸可实际渲染并导出300dpi单页PDF',resized.every(r=>r.bytes>10000&&r.pixels.every((n,i)=>n===r.expected[i])),JSON.stringify(resized));
 await cdp.eval(`(async()=>{const c=await import('./web/js/core.js'),b=await import('./web/js/book.js');c.loadProject(b.bookPage(b.bookPlan({size:'Weeks'}),0));c.emit('changed');document.querySelector('[data-tab="print"]').click();})()`);await pause(300);
 check('从成册打开Weeks页后，打印设置同步为Weeks且零出血',await cdp.eval(`document.querySelector('#print-size').value==='Weeks'&&document.querySelector('#print-bleed').value==='0'&&!document.querySelector('#print-crop').checked`));
 await cdp.eval(`document.querySelector('[data-tab="works"]').click();document.querySelector('#book-builder').open=true`);await pause(400);
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await pause(400);await cdp.eval(`document.querySelector('#book-builder').scrollIntoView({block:'start'})`);await pause(300);
 check('手机成册表单输入框完整显示',await cdp.eval(`(()=>{const r=document.querySelector('#book-size').getBoundingClientRect();return r.width>200&&r.left>=0&&r.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth+1;})()`));
 writeFileSync(join(art,'book-mobile-form.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await cdp.send('Emulation.clearDeviceMetricsOverride');
}
