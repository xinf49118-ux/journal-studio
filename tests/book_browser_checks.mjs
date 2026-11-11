import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function bookChecks(cdp,check,art){
 console.log('\n[整册与多尺寸] 日期、纸张、预览、取消与实际PDF');
 const before=await cdp.eval(`(async()=>JSON.stringify((await import('./web/js/core.js')).serializeProject()))()`);
 const base=await cdp.eval('location.href.split("?")[0]');await cdp.send('Page.navigate',{url:base+'?tool=book'});await pause(2800);
 check('成册直达链接打开预览，保留当前草稿',await cdp.eval(`document.querySelector('#book-builder').open&&document.querySelector('#book-preview').naturalWidth>0&&!document.querySelector('#book-export').disabled`)&&(await cdp.eval(`(async()=>JSON.stringify((await import('./web/js/core.js')).serializeProject()))()`))===before);
 const set=async values=>{await cdp.eval(`(()=>{const v=${JSON.stringify(values)};for(const [id,value] of Object.entries(v)){const e=document.querySelector('#book-'+id);if(typeof value==='boolean')e.checked=value;else e.value=String(value);}document.querySelector('#book-options').dispatchEvent(new Event('change'));})()`);await pause(400);};
 await set({mode:'range',start:'2024-03-02',end:'2024-03-01'});
 check('无效时段阻止整册导出',await cdp.eval(`document.querySelector('#book-export').disabled&&document.querySelector('#book-status').textContent.includes('结束日期')`));
 await set({mode:'year',year:2024,size:'A6',type:'daily'});
 check('闰年成册实际目录含384页',await cdp.eval(`document.querySelector('#book-page').options.length===384`));
 await cdp.eval(`document.querySelector('#book-next').click()`);await pause(300);
 check('预览可翻页并显示目录',await cdp.eval(`document.querySelector('#book-preview').alt.includes('目录')`));
 // Intercept downloads, inspect the real PDF bytes without opening a system dialog.
 await cdp.eval(`window.__bookOldClick=HTMLAnchorElement.prototype.click;window.__bookDownload=null;HTMLAnchorElement.prototype.click=function(){if(this.download.endsWith('.pdf'))fetch(this.href).then(r=>r.arrayBuffer()).then(a=>{const t=new TextDecoder('latin1').decode(a);window.__bookDownload={bytes:a.byteLength,pages:Number(t.match(new RegExp('/Count ([0-9]+)'))?.[1]),box:t.split('/MediaBox [')[1]?.split(']')[0].split(' ').map(Number)};});else window.__bookOldClick.call(this);}`);
 await cdp.eval(`document.querySelector('#book-export').click()`);await pause(100);
 check('导出中锁定选项，允许取消',await cdp.eval(`document.querySelector('#book-size').disabled&&!document.querySelector('#book-cancel').hidden`));
 await cdp.eval(`document.querySelector('#book-cancel').click()`);await pause(600);
 check('取消不下载半成品，并恢复控件',await cdp.eval(`window.__bookDownload===null&&!document.querySelector('#book-size').disabled&&!document.querySelector('#book-export').disabled&&document.querySelector('#book-status').textContent.includes('已取消')`));
 for(const cfg of [{mode:'year',year:2024,type:'daily',size:'A6',paper:'native',notes:4,expected:384,w:105,h:148},{mode:'year',year:2027,type:'weekly',size:'Weeks',paper:'native',notes:4,expected:71,w:94,h:188},{mode:'range',start:'2024-02-29',end:'2024-03-01',type:'daily',size:'B6',paper:'a4',notes:0,expected:6,w:210,h:297}]){
  const {expected,w,h,...values}=cfg;await set(values);await cdp.eval(`window.__bookDownload=null;document.querySelector('#book-export').click()`);
  let result=null;for(let i=0;i<240;i++){await pause(500);result=await cdp.eval('window.__bookDownload');if(result)break;}
  check(`${cfg.size} ${cfg.type}整册实际导出${expected}页，PDF物理尺寸正确`,!!result&&result.pages===expected&&result.bytes>10000&&Math.abs(result.box[2]*25.4/72-w)<.01&&Math.abs(result.box[3]*25.4/72-h)<.01,JSON.stringify(result));
 }
 await cdp.eval(`HTMLAnchorElement.prototype.click=window.__bookOldClick`);
 check('成册预览、取消与多次导出未改写草稿',(await cdp.eval(`(async()=>JSON.stringify((await import('./web/js/core.js')).serializeProject()))()`))===before);
 // Measure text using the same renderer; save contacts for visual review at every size.
 const visual=await cdp.eval(`(async()=>{
  const {bookPlan,bookPage}=await import('./web/js/book.js'),{renderToPngBlob,TEXT_LINE_HEIGHT}=await import('./web/js/render.js'),{cssFontFamily}=await import('./web/js/stage.js'),{PAGE_SIZES}=await import('./web/js/core.js');
  const probe=document.createElement('canvas').getContext('2d'),errors=[],shots=[];
  for(const size of ['A5','A6','B6','Weeks']){const b=bookPlan({size,year:2024,type:'daily',title:'给日子留一页 · 我的生活记录'}),week=bookPlan({size,year:2024,type:'weekly'}),pages=[bookPage(b,0),bookPage(b,1),bookPage(b,b.pages.findIndex(p=>p.month==='2024-02')),bookPage(week,3),bookPage(b,3),bookPage(b,b.pages.length-1)];
   const canvas=document.createElement('canvas');canvas.width=900;canvas.height=900;const ctx=canvas.getContext('2d');ctx.fillStyle='#eeeae3';ctx.fillRect(0,0,900,900);
   for(let i=0;i<pages.length;i++){const p=pages[i],[w,h]=PAGE_SIZES[size];for(const l of p.layers.filter(l=>l.kind==='text')){probe.font=Math.round(l.size_mm*300/25.4)+'px '+cssFontFamily(l.font);const width=probe.measureText(l.text).width*25.4/300;if(l.x_mm+width>w-5||l.y_mm+l.size_mm*TEXT_LINE_HEIGHT>h-4)errors.push(size+':'+l.text);}
    const bm=await createImageBitmap(await renderToPngBlob({...p,page:{...p.page,dpi:85}}));const scale=Math.min(280/bm.width,415/bm.height);ctx.drawImage(bm,i%3*300+(300-bm.width*scale)/2,Math.floor(i/3)*450+12,bm.width*scale,bm.height*scale);bm.close();}
   shots.push({size,image:canvas.toDataURL().split(',')[1]});
  }return {errors,shots};})()`);
 check('四种尺寸的封面、目录和月周日页文字均未越界',visual.errors.length===0,JSON.stringify(visual.errors));
 for(const s of visual.shots)writeFileSync(join(art,'book-'+s.size+'.png'),Buffer.from(s.image,'base64'));
 await set({mode:'year',year:2027,type:'weekly',size:'Weeks',paper:'native'});
 await cdp.eval(`document.querySelector('#book-builder').scrollIntoView({block:'start'})`);
 writeFileSync(join(art,'book-desktop.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await pause(300);await cdp.eval(`document.querySelector('#book-builder').scrollIntoView({block:'start'})`);await pause(150);
 check('390px手机成册工具没有横向溢出',await cdp.eval('document.documentElement.scrollWidth<=innerWidth+1'));
 writeFileSync(join(art,'book-mobile.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await cdp.send('Emulation.clearDeviceMetricsOverride');
 await cdp.eval(`document.querySelector('#book-edit').click()`);await pause(1800);
 check('成册单页可独立编辑且保留Weeks纸张和备份',await cdp.eval(`(async()=>{const c=await import('./web/js/core.js'),b=await import('./web/js/backup.js');b.validateBundle(await b.makeBundle(c.serializeProject(),[],()=>{}),new Set(c.state.materials.items.map(m=>m.id)));return c.state.page.size==='Weeks'&&document.querySelector('#page-size').value==='Weeks'&&document.querySelector('#tab-editor').classList.contains('active');})()`));
 // Three-size generator paths and global print size changes must retain content.
 for(const size of ['A6','B6','A5']){
  await cdp.eval(`document.querySelector('[data-tab="works"]').click();document.querySelector('#planner-size').value=${JSON.stringify(size)};document.querySelector('#planner-size').dispatchEvent(new Event('change',{bubbles:true}))`);await pause(400);await cdp.eval(`document.querySelector('#apply-planner').click()`);await pause(1000);
  check(`${size}单页生成、保存和编辑尺寸一致`,await cdp.eval(`(async()=>{const c=await import('./web/js/core.js');return c.state.page.size===${JSON.stringify(size)}&&document.querySelector('#page-size').value===${JSON.stringify(size)}&&document.querySelector('#save-status').dataset.status==='saved';})()`));
 }
 await cdp.eval(`history.replaceState(null,'',location.pathname);document.querySelector('[data-tab="works"]').click();document.querySelector('#book-builder').open=false`);
}
