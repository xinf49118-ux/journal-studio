import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function catalogChecks(cdp,check,art){
 console.log('\n[系列参考] 完整目录与扩展内页');
 const before=await cdp.eval(`(async()=>JSON.stringify((await import('./web/js/core.js')).serializeProject()))()`);
 await cdp.eval(`document.querySelector('[data-tab="reference"]').click()`);await pause(250);
 check('37项系列参考有来源链接和可用内页入口',await cdp.eval(`document.querySelectorAll('.reference-card').length===37 && [...document.querySelectorAll('.reference-card')].every(c=>c.querySelector('a[href^="https://"]')&&c.querySelector('button'))`));
 check('五个国产品牌可分别筛选，历史资料和店铺限制清楚标明',await cdp.eval(`(()=>{const s=document.querySelector('#reference-brand');const names=['kinbor','九口山','趁早','MOODTAPE','陌墨 MO.CARD'];return names.every(n=>{s.value=n;s.dispatchEvent(new Event('change'));const c=document.querySelectorAll('.reference-card');return c.length===1 && (n!=='九口山'||c[0].textContent.includes('2021')) && (n!=='陌墨 MO.CARD'||c[0].textContent.includes('未展示商品'));})})()`));
 await cdp.eval(`document.querySelector('#reference-brand').value='MIDORI';document.querySelector('#reference-brand').dispatchEvent(new Event('change'))`);
 check('品牌筛选显示MIDORI的三个系列',await cdp.eval(`document.querySelectorAll('.reference-card').length===3 && [...document.querySelectorAll('.reference-card')].every(c=>c.textContent.includes('MIDORI'))`));
 await cdp.eval(`document.querySelector('.reference-card button').click();document.querySelector('#planner-date').value='2024-02-29';document.querySelector('#planner-date').dispatchEvent(new Event('change',{bubbles:true}))`);await pause(500);
 await cdp.eval(`document.querySelector('#planner-companion').click()`);await pause(500);
 check('配套页切换保留日期，且预览不覆盖草稿',await cdp.eval(`document.querySelector('#planner-layout').value==='life_right' && document.querySelector('#planner-date').value==='2024-02-29' && !document.querySelector('#apply-planner').disabled`)&&(await cdp.eval(`(async()=>JSON.stringify((await import('./web/js/core.js')).serializeProject()))()`))===before);
 await cdp.eval(`document.querySelector('[data-tab="reference"]').click();document.querySelector('#reference-brand').value='';document.querySelector('#reference-brand').dispatchEvent(new Event('change'))`);
 await cdp.eval(`document.querySelector('#reference-search').value='Pat-mi';document.querySelector('#reference-search').dispatchEvent(new Event('input'))`);
 check('历史系列可搜索并明确标出年份',await cdp.eval(`document.querySelectorAll('.reference-card').length===1 && document.querySelector('.reference-card').textContent.includes('2017')`));
 await cdp.eval(`document.querySelector('.reference-card button').click()`);await pause(350);
 check('参考目录入口选中月周同页，预览不改动现有草稿',await cdp.eval(`document.querySelector('#planner-layout').value==='month_week' && document.querySelector('#tab-works').classList.contains('active')`)&&(await cdp.eval(`(async()=>JSON.stringify((await import('./web/js/core.js')).serializeProject()))()`))===before);
 await cdp.eval(`(()=>{document.querySelector('#planner-group').value='学习计划';document.querySelector('#planner-group').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#planner-search').value='备考';document.querySelector('#planner-search').dispatchEvent(new Event('input'));})()`);await pause(350);
 check('用途与关键词组合筛选能找到两周备考',await cdp.eval(`document.querySelector('#planner-layout').options.length===1 && document.querySelector('#planner-layout').value==='study_2weeks'`));
 await cdp.eval(`document.querySelector('#planner-search').value='no-such-page';document.querySelector('#planner-search').dispatchEvent(new Event('input'))`);await pause(200);
 check('没有搜索结果时禁用生成，保护已有草稿',await cdp.eval(`document.querySelector('#apply-planner').disabled && document.querySelector('#planner-layout').options.length===0`));
 await cdp.eval(`(()=>{document.querySelector('#planner-search').value='';document.querySelector('#planner-group').value='';document.querySelector('#planner-group').dispatchEvent(new Event('change',{bubbles:true}));})()`);
 const catalog=await cdp.eval(`(async()=>{
  const p=await import('./web/js/planner.js');return p.plannerLayouts.map(l=>({id:l.id,name:l.name,group:l.group}));
 })()`);
 const results=[];
 for(const layout of catalog){
  const r=await cdp.eval(`(async()=>{
   const c=await import('./web/js/core.js'),p=await import('./web/js/planner.js'),r=await import('./web/js/render.js'),s=await import('./web/js/stage.js');
   const project=p.plannerProject({layout:${JSON.stringify(layout.id)},theme:'garden',month:'2024-02',date:'2024-02-29',year:'2024'},c.state.materials.items);
   const probe=document.createElement('canvas').getContext('2d');
   const overflow=project.layers.filter(l=>l.kind==='text').filter(l=>{probe.font=(l.size_mm*4)+'px '+s.cssFontFamily(l.font);return l.x_mm+probe.measureText(l.text).width/4>138;}).map(l=>l.text);
   const blob=await r.renderToPngBlob({...project,page:{...project.page,dpi:100}});const bitmap=await createImageBitmap(blob);
   const canvas=document.createElement('canvas');canvas.width=592;canvas.height=840;canvas.getContext('2d').drawImage(bitmap,0,0,592,840);bitmap.close();
   return {id:${JSON.stringify(layout.id)},bytes:blob.size,layers:project.layers.length,overflow,image:canvas.toDataURL().split(',')[1]};
  })()`);
  writeFileSync(join(art,'catalog-'+layout.id+'.png'),Buffer.from(r.image,'base64'));delete r.image;results.push(r);
 }
 check('87种内页全部实际渲染，文字未超出纸张安全区',results.every(r=>r.bytes>3000&&r.layers<1000&&r.overflow.length===0),JSON.stringify(results.filter(r=>r.overflow.length)));
 writeFileSync(join(art,'catalog-render-results.json'),JSON.stringify(results,null,2));
 // Render contact sheets from the actual exported pages for visual review.
 for(const group of [...new Set(catalog.map(l=>l.group))]){
  const ids=catalog.filter(l=>l.group===group).map(l=>l.id);
  const data=await cdp.eval(`(async()=>{
   const p=await import('./web/js/planner.js'),r=await import('./web/js/render.js'),c=await import('./web/js/core.js'),ids=${JSON.stringify(ids)};
   const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=Math.ceil(ids.length/4)*440;const ctx=canvas.getContext('2d');ctx.fillStyle='#e8e4dc';ctx.fillRect(0,0,canvas.width,canvas.height);
   for(let i=0;i<ids.length;i++){const l=p.plannerLayouts.find(l=>l.id===ids[i]);const project=p.plannerProject({layout:l.id,theme:'garden',month:'2024-02',date:'2024-02-29',year:'2024'},c.state.materials.items);const bitmap=await createImageBitmap(await r.renderToPngBlob({...project,page:{...project.page,dpi:72}}));const x=i%4*300,y=Math.floor(i/4)*440;ctx.drawImage(bitmap,x+10,y+8,280,397);bitmap.close();ctx.fillStyle='#405344';ctx.font='14px sans-serif';ctx.fillText(l.name,x+12,y+425);}
   return canvas.toDataURL().split(',')[1];
  })()`);
  writeFileSync(join(art,'catalog-sheet-'+group+'.png'),Buffer.from(data,'base64'));
 }
 await cdp.eval(`(()=>{document.querySelector('[data-tab="reference"]').click();document.querySelector('#reference-search').value='';document.querySelector('#reference-search').dispatchEvent(new Event('input'));})()`);
 writeFileSync(join(art,'catalog-reference-desktop.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await pause(300);
 check('390px手机系列目录没有横向溢出',await cdp.eval(`document.documentElement.scrollWidth<=innerWidth+1`));
 writeFileSync(join(art,'catalog-reference-mobile.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await cdp.send('Emulation.clearDeviceMetricsOverride');
 const base=await cdp.eval(`location.href.split('?')[0]`);
 await cdp.send('Page.navigate',{url:base+'?layout=annual_calendar'});await pause(3000);
 check('完整整理的内页直达链接可用，打开时不覆盖草稿',await cdp.eval(`document.querySelector('#planner-layout').value==='annual_calendar' && document.querySelector('#tab-works').classList.contains('active')`)&&(await cdp.eval(`(async()=>JSON.stringify((await import('./web/js/core.js')).serializeProject()))()`))===before);
 await cdp.eval(`(()=>{document.querySelector('#planner-year').value='2024';document.querySelector('#planner-year').dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(400);
 check('年度内页使用独立年份控件',await cdp.eval(`!document.querySelector('#planner-year-field').hidden && document.querySelector('#planner-date-field').hidden && !document.querySelector('#apply-planner').disabled`));
 const guide=await cdp.eval(`(async()=>{const text=await(await fetch('./docs/kokuyo-guide.html')).text();return text.includes('49种')&&text.includes('21项')&&text.includes('?layout=study_2weeks')&&text.includes('2026规格表');})()`);
 check('完整整理包含系列、49种内页及可点击入口',guide);
 check('多品牌整理包含87种内页与日系品牌',await cdp.eval(`(async()=>{const t=await(await fetch('./docs/brands-guide.html')).text();return t.includes('87种')&&t.includes('Hobonichi')&&t.includes('MIDORI')&&t.includes('TRAVELER')&&t.includes('?layout=tickets');})()`));
 check('完整整理包含国产品牌与新内页入口',await cdp.eval(`(async()=>{const t=await(await fetch('./docs/brands-guide.html')).text();return ['kinbor','九口山','趁早','MOODTAPE','陌墨','?layout=plant_observation','?layout=goal_steps','613 件素材'].every(s=>t.includes(s));})()`));
 await cdp.eval(`history.replaceState(null,'',location.pathname);document.querySelector('#planner-layout').value='monthly';document.querySelector('#planner-layout').dispatchEvent(new Event('change',{bubbles:true}))`);await pause(250);
}
