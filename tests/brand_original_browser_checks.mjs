import {existsSync} from 'node:fs';import {join} from 'node:path';const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function brandOriginalChecks(cdp,check,art){
 const page=await cdp.eval(`(async()=>{const f=document.createElement('iframe');f.src='./docs/brand-original.html';f.style.width='390px';document.body.append(f);await new Promise(r=>f.onload=r);const d=f.contentDocument,total=d.querySelectorAll('article').length,q=d.querySelector('#search');q.value='印章';q.dispatchEvent(new f.contentWindow.Event('input'));const filtered=[...d.querySelectorAll('article')].filter(n=>!n.hidden).length,fit=d.documentElement.scrollWidth<=f.contentWindow.innerWidth+1,text=d.body.textContent,images=d.querySelectorAll('img').length;f.remove();return {total,filtered,fit,text,images};})()`);
 check('品牌原版入口展示11项官方来源，支持印章搜索',page.total===11&&page.filtered>0&&page.filtered<11);
 check('来源页标明实际取得范围，不把原创或商品目录当成原版',page.text.includes('原版印面文件当前为0份')&&page.text.includes('3份原版剪贴设计纸')&&page.images===0);
 check('品牌原版入口适配手机宽度',page.fit);
 if(!existsSync(join(art,'official-original-1.journal.json'))){console.log('  ⏭ 未提供个人原版文件，跳过个人文件导入验证');return;}
 const sheets=await cdp.eval(`(async()=>{const b=await import('./web/js/backup.js');let count=0;for(let i=1;i<=3;i++){const data=await(await fetch('./tests/_artifacts/official-original-'+i+'.journal.json')).json();b.validateBundle(data);const img=await createImageBitmap(await(await fetch(data.assets[0].data)).blob());if(img.width<2480||img.height<3508)return false;img.close();count++;}return count===3;})()`);
 check('3份实际官方原版均为可恢复的300dpi图片备份',sheets);
 await cdp.eval('window.confirm=()=>true');const {root}=await cdp.send('DOM.getDocument');const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#backup-file'});await cdp.send('DOM.setFileInputFiles',{nodeId,files:[join(art,'official-original-1.journal.json')]});await pause(2000);
 check('个人原版文件能通过真实导入备份入口恢复为A4页面',await cdp.eval(`(async()=>{const c=await import('./web/js/core.js');return c.state.page.size==='A4'&&c.state.layers.length===1&&c.state.layers[0].kind==='image'&&c.state.layers[0].w_mm===210&&c.state.library.some(i=>i.name.includes('KING JIM'))})()`));
 const rendered=await cdp.eval(`(async()=>{const c=await import('./web/js/core.js'),r=await import('./web/js/render.js'),p=await import('./web/js/pdf.js');const jpeg=await r.renderToJpeg(c.serializeProject());return p.buildPdf([jpeg],{pageWmm:210,pageHmm:297}).length>10000})()`);
 check('导入的品牌原版可在工坊实际生成A4打印PDF',rendered);
}
