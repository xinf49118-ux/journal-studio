import {existsSync,writeFileSync} from 'node:fs';import {join} from 'node:path';const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function brandOriginalChecks(cdp,check,art){
 const page=await cdp.eval(`(async()=>{const f=document.createElement('iframe');f.src='./docs/brand-original.html';f.style.width='390px';document.body.append(f);await new Promise(r=>f.onload=r);const d=f.contentDocument,total=d.querySelectorAll('article').length,q=d.querySelector('#search');q.value='印章';q.dispatchEvent(new f.contentWindow.Event('input'));const filtered=[...d.querySelectorAll('article')].filter(n=>!n.hidden).length,fit=d.documentElement.scrollWidth<=f.contentWindow.innerWidth+1,text=d.body.textContent,images=d.querySelectorAll('img').length;f.remove();return {total,filtered,fit,text,images};})()`);
 check('品牌原版入口展示18项官方来源，支持印章搜索',page.total===18&&page.filtered>0&&page.filtered<18);
 check('来源页标明6份官方合作图案、26个原图区域与5份剪贴日期纸',page.text.includes('6份雕章图案PDF')&&page.text.includes('26个个人用图案')&&page.text.includes('日期纸共5份')&&page.images===0);
 check('来源清单将个人已取得文件与公共素材分别统计',await cdp.eval(`(async()=>{const d=await(await fetch('./docs/brand-original-data.json')).json();return d.official_stamp_pattern_files_verified===6&&d.private_stamp_regions_prepared===26&&d.personal_download_sheets_verified===5&&d.publicly_bundled_brand_artwork===0&&d.retail_digital_stamp_packs_verified===0})()`));
 check('品牌原版入口适配手机宽度',page.fit);
 if(!existsSync(join(art,'official-original-1.journal.json'))){console.log('  ⏭ 未提供个人原版文件，跳过个人文件导入验证');return;}
 const sheets=await cdp.eval(`(async()=>{const b=await import('./web/js/backup.js');let count=0;for(let i=1;i<=3;i++){const data=await(await fetch('./tests/_artifacts/official-original-'+i+'.journal.json')).json();b.validateBundle(data);const img=await createImageBitmap(await(await fetch(data.assets[0].data)).blob());if(img.width<2480||img.height<3508)return false;img.close();count++;}return count===3;})()`);
 check('3份实际官方原版均为可恢复的300dpi图片备份',sheets);
 await cdp.eval('window.confirm=()=>true');const {root}=await cdp.send('DOM.getDocument');const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#backup-file'});await cdp.send('DOM.setFileInputFiles',{nodeId,files:[join(art,'official-original-1.journal.json')]});await pause(2000);
 check('个人原版文件能通过真实导入备份入口恢复为A4页面',await cdp.eval(`(async()=>{const c=await import('./web/js/core.js');return c.state.page.size==='A4'&&c.state.layers.length===1&&c.state.layers[0].kind==='image'&&c.state.layers[0].w_mm===210&&c.state.library.some(i=>i.name.includes('KING JIM'))})()`));
 const rendered=await cdp.eval(`(async()=>{const c=await import('./web/js/core.js'),r=await import('./web/js/render.js'),p=await import('./web/js/pdf.js');const jpeg=await r.renderToJpeg(c.serializeProject());return p.buildPdf([jpeg],{pageWmm:210,pageHmm:297}).length>10000})()`);
 check('导入的品牌原版可在工坊实际生成A4打印PDF',rendered);
 if(existsSync(join(art,'acquired-stamps.journal.json'))){
  await cdp.send('DOM.setFileInputFiles',{nodeId,files:[join(art,'acquired-stamps.journal.json')]});await pause(2200);
  check('26个官方合作印章图案可通过真实备份入口独立恢复',await cdp.eval(`(async()=>{const c=await import('./web/js/core.js'),images=c.state.layers.filter(l=>l.kind==='image');return c.state.page.size==='A4'&&images.length===26&&images.every(l=>l.blend==='multiply')&&new Set(images.map(l=>l.ref)).size===26})()`));
  check('取得的原图可实际生成有透明背景的新墨色印章',await cdp.eval(`(async()=>{const c=await import('./web/js/core.js'),f=await import('./web/js/craft.js'),im=new Image();im.src=c.layerSrc(c.state.layers.find(l=>l.kind==='image'));await im.decode();const out=f.effectCanvas(im,{effect:'stamp',color:'#365f94',density:.9,wear:0,ghost:0}).canvas,p=out.getContext('2d').getImageData(0,0,out.width,out.height).data;let n=0;for(let i=3;i<p.length;i+=4)if(p[i]>0)n++;return p[3]===0&&n>100})()`));
  const board=await cdp.eval(`(async()=>{const c=await import('./web/js/core.js'),r=await import('./web/js/render.js'),pdf=await import('./web/js/pdf.js'),canvas=await r.renderToCanvas(c.serializeProject()),jpeg=await r.renderToJpeg(c.serializeProject());return {image:canvas.toDataURL().split(',')[1],bytes:pdf.buildPdf([jpeg],{pageWmm:210,pageHmm:297}).length}})()`);
  check('26图案排版实际生成可打印PDF',board.bytes>10000);writeFileSync(join(art,'brand-acquired-stamp-board.png'),Buffer.from(board.image,'base64'));
 }
}
