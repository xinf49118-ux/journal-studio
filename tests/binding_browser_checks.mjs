import {writeFileSync} from 'node:fs';import {join} from 'node:path';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function bindingChecks(cdp,check,art){
 await cdp.send('Page.navigate',{url:(await cdp.eval('location.href.split("?")[0]'))+'?tool=diy'});await pause(2200);
 const change=async(id,value)=>{await cdp.eval(`document.querySelector('#diy-${id}').${typeof value==='boolean'?'checked':'value'}=${JSON.stringify(value)};document.querySelector('#diy-${id}').dispatchEvent(new Event('change'))`);await pause(350);};
 const click=async id=>{await cdp.eval(`document.querySelector('#diy-${id}').click()`);await pause(400);};
 await change('size','Custom');await change('width',120);await change('height',180);await cdp.eval(`document.querySelector('#diy-template').value='daily'`);await click('add');
 check('可自定义120×180mm并添加功能页',await cdp.eval(`document.querySelector('#diy-size').value==='Custom'&&!document.querySelector('#diy-custom-fields').hidden&&document.querySelector('#diy-page').options.length===1`));
 await click('edit');check('自定义尺寸可进入编辑器和备份',await cdp.eval(`(async()=>{const c=await import('./web/js/core.js'),b=await import('./web/js/backup.js');b.validateBundle({format:'journal-studio-backup',version:1,project:c.serializeProject(),assets:[]});return c.state.page.size==='Custom'&&c.state.page.w_mm===120&&c.state.page.h_mm===180;})()`));
 await cdp.eval(`document.querySelector('#diy-return').click()`);await pause(700);
 for(let i=0;i<4;i++)await click('copy');await change('toc',false);
 await cdp.eval(`window.__bindingOldClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download.endsWith('.pdf'))fetch(this.href).then(r=>r.arrayBuffer()).then(a=>{const t=new TextDecoder('latin1').decode(a);window.__bindingPdf={bytes:a.byteLength,pages:Number(t.match(new RegExp('/Count ([0-9]+)'))?.[1]),box:t.split('/MediaBox [')[1]?.split(']')[0].split(' ').map(Number)};});else window.__bindingOldClick.call(this);}`);
 for(const [size,mode,holes,count,w,h] of [['Custom','native','two',5,120,180],['Custom','a4-duplex','six',6,210,297],['A6','booklet','none',4,297,210],['A5','booklet','none',4,420,297]]){
  await change('size',size);await change('holes',holes);await change('paper',mode);await click('proof');await pause(400);
  check(`${size} ${mode}印面可预览`,await cdp.eval(`document.querySelector('#diy-preview').naturalWidth>0&&document.querySelector('#diy-status').textContent.includes('第一印面预览')`));
  const shot=await cdp.eval(`(async()=>{const r=await fetch(document.querySelector('#diy-preview').src);const b=await r.blob();return await new Promise(res=>{const f=new FileReader();f.onload=()=>res(f.result.split(',')[1]);f.readAsDataURL(b)});})()`);writeFileSync(join(art,`binding-${size}-${mode}.png`),Buffer.from(shot,'base64'));
  await cdp.eval(`window.__bindingPdf=null`);await click('export');let result=null;for(let n=0;n<50;n++){await pause(250);result=await cdp.eval('window.__bindingPdf');if(result)break;}
  check(`${size} ${mode}实际PDF页数与毫米尺寸正确`,!!result&&result.pages===count&&Math.abs(result.box[2]*25.4/72-w)<.01&&Math.abs(result.box[3]*25.4/72-h)<.01,JSON.stringify(result));
 }
 await change('holes','six');await click('export');check('活页打孔与对折装订不能误用同一方案',await cdp.eval(`document.querySelector('#diy-status').textContent.includes('分别导出')`));
 await change('paper','a4-duplex');await change('size','Custom');await change('width',120);await change('height',180);
 await cdp.send('Page.reload');await pause(2100);
 check('刷新后保留自定义尺寸、孔位和打印方案',await cdp.eval(`document.querySelector('#diy-size').value==='Custom'&&document.querySelector('#diy-width').value==='120'&&document.querySelector('#diy-holes').value==='six'&&document.querySelector('#diy-paper').value==='a4-duplex'`));
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await pause(250);await cdp.eval(`document.querySelector('#diy-builder').scrollIntoView({block:'start'})`);
 check('手机自定义尺寸与装订表单无横向溢出',await cdp.eval('document.documentElement.scrollWidth<=innerWidth+1'));
 await cdp.send('Emulation.clearDeviceMetricsOverride');await cdp.eval(`HTMLAnchorElement.prototype.click=window.__bindingOldClick||HTMLAnchorElement.prototype.click`);
}
