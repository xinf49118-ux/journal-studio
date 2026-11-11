import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function plannerChecks(cdp,check,art) {
 console.log('\n[功能内页] 日期、主题、素材与实际导出');
 await cdp.eval(`document.querySelector('[data-tab="works"]').click()`);await pause(1200);
 check('内页预览已加载、四种用途和六个主题可选',await cdp.eval(`document.querySelector('#planner-preview').naturalWidth>0 && document.querySelector('#planner-layout').options.length===4 && document.querySelectorAll('.theme-choice').length===6`));
 for(const layout of ['monthly','weekly','daily','habits']) {
  await cdp.eval(`(()=>{
   document.querySelector('#planner-layout').value=${JSON.stringify(layout)};
   document.querySelector('#planner-month').value='2024-02';document.querySelector('#planner-date').value='2024-02-29';
   document.querySelectorAll('.theme-choice')[1].click();document.querySelector('#planner-layout').dispatchEvent(new Event('change',{bubbles:true}));
  })()`);await pause(600);
  await cdp.eval(`document.querySelector('#apply-planner').click()`);await pause(1300);
  const result=await cdp.eval(`(async()=>{
   const c=await import('./web/js/core.js'),r=await import('./web/js/render.js'),pdf=await import('./web/js/pdf.js');
   const req=c.buildRenderRequest();const blob=await r.renderToPngBlob(req);const bmp=await createImageBitmap(blob);
   const jpeg=await r.renderToJpeg(req),bytes=pdf.buildPdf([{jpeg:jpeg.jpeg,width:jpeg.width,height:jpeg.height}],{pageWmm:148,pageHmm:210,dpi:300});
   const canvas=document.createElement('canvas');canvas.width=592;canvas.height=840;canvas.getContext('2d').drawImage(bmp,0,0,592,840);bmp.close();
   return {count:c.state.layers.length,png:blob.size,pdf:bytes.length,dimensions:[jpeg.width,jpeg.height],saved:document.querySelector('#save-status').dataset.status,theme:c.state.layers.find(l=>l.kind==='material').ref,image:canvas.toDataURL('image/png').split(',')[1]};
  })()`);
  writeFileSync(join(art,`planner-${layout}.png`),Buffer.from(result.image,'base64'));
  check(`${layout} 内页可编辑、保存并以300dpi导出PNG/PDF`,result.count>40&&result.png>10000&&result.pdf>10000&&result.dimensions[0]===1748&&result.dimensions[1]===2480&&result.saved==='saved'&&result.theme.includes('garden'),JSON.stringify({...result,image:undefined}));
  await cdp.eval(`document.querySelector('[data-tab="works"]').click()`);await pause(200);
 }
 check('切换内页前自动保留上一份草稿',await cdp.eval(`(async()=>{const {shelf}=await import('./web/js/backup.js');return (await shelf('list')).filter(r=>r.name.includes('切换前备份')).length>=3})()`));
 await cdp.eval(`(()=>{
  document.querySelector('#planner-layout').value='monthly';document.querySelector('#planner-month').value='';document.querySelector('#planner-layout').dispatchEvent(new Event('change',{bubbles:true}));
 })()`);await pause(400);
 check('清空月份会提示修正并禁用生成',await cdp.eval(`document.querySelector('#apply-planner').disabled && document.querySelector('#planner-preview').hidden`));
 await cdp.eval(`document.querySelector('#planner-undated').click()`);await pause(500);
 check('无日期模式允许空日期并恢复生成',await cdp.eval(`!document.querySelector('#apply-planner').disabled && document.querySelector('#planner-month').disabled`));
 // Rapid changes: the preview and generated page must both use the final selection.
 await cdp.eval(`(()=>{for(const b of document.querySelectorAll('.theme-choice'))b.click();document.querySelector('#planner-layout').value='daily';document.querySelector('#planner-layout').dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(800);
 check('快速切换不会留下过期主题预览',await cdp.eval(`document.querySelector('#planner-preview').alt.includes('节庆心愿') && document.querySelector('#planner-preview').alt.includes('每日记录')`));
 writeFileSync(join(art,'planner-builder-desktop.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await pause(400);
 check('390px手机内页选择器完整显示，无横向溢出',await cdp.eval(`document.documentElement.scrollWidth<=innerWidth+1 && document.querySelector('#planner-layout').getBoundingClientRect().width>200`));
 writeFileSync(join(art,'planner-builder-mobile.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
 await cdp.send('Emulation.clearDeviceMetricsOverride');
 await cdp.eval(`(()=>{document.querySelector('[data-tab="library"]').click();document.querySelector('#collection-filter').value='garden';document.querySelector('#collection-filter').dispatchEvent(new Event('change'));document.querySelector('#usage-filter').value='functional';document.querySelector('#usage-filter').dispatchEvent(new Event('change'));})()`);await pause(400);
 check('主题与功能素材可组合筛选为32件',await cdp.eval(`document.querySelectorAll('.mat-card').length===32`));
 await cdp.eval(`document.querySelector('#mat-search').value='晴天';document.querySelector('#mat-search').dispatchEvent(new Event('input'))`);
 check('功能贴纸可按天气词搜索',await cdp.eval(`document.querySelectorAll('.mat-card').length===1`));
 await cdp.eval(`document.querySelector('.mat-card .mat-actions button').click()`);await pause(400);
 check('功能贴纸可实际加入内页',await cdp.eval(`(async()=>{const {state}=await import('./web/js/core.js');return state.layers.some(l=>l.ref==='icon_planner_garden_weather_0')})()`));
 await cdp.eval(`(()=>{document.querySelector('#mat-search').value='';document.querySelector('#mat-search').dispatchEvent(new Event('input'));document.querySelector('#usage-filter').value='';document.querySelector('#usage-filter').dispatchEvent(new Event('change'));document.querySelector('#collection-filter').value='';document.querySelector('#collection-filter').dispatchEvent(new Event('change'));})()`);
}
