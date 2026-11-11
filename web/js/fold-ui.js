import {foldSheets,foldSizes} from './fold.js';
import {renderToPngBlob,renderToJpeg} from './render.js';
import {buildPdf} from './pdf.js';
import {downloadBlob} from './api.js';
import {$,err} from './ui.js';
export function initFold(){
 const form=$('#fold-options'),image=$('#fold-preview'),status=$('#fold-status'),button=$('#fold-export');let revision=0,url=null,busy=false;
 const options=()=>({size:$('#fold-size').value,panels:Number($('#fold-panels').value),style:$('#fold-style').value});
 async function preview(){
  const token=++revision;button.disabled=true;
  try{const o=options(),pages=foldSheets(o);const blob=await renderToPngBlob({...pages[0],page:{...pages[0].page,dpi:65}});
   if(token!==revision)return;if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);image.src=url;image.hidden=false;
   status.textContent=`${o.panels} 面，${pages.length} 张 A4 · 单面打印 · 每面 ${foldSizes[o.size].name}。先按实线裁切，依序接贴，再沿虚线交替折叠。`;button.disabled=busy;
  }catch(e){if(token===revision){image.hidden=true;status.textContent=e.message;}}
 }
 form.onsubmit=e=>e.preventDefault();form.onchange=preview;
 button.onclick=async()=>{
  if(busy)return;busy=true;button.disabled=true;
  // Snapshot before any async work; controls are locked until the exact PDF finishes.
  const o=options();const inputs=[...form.querySelectorAll('select')];inputs.forEach(e=>e.disabled=true);
  try{const pages=foldSheets(o),images=[];
   for(let i=0;i<pages.length;i++){status.textContent=`正在生成第 ${i+1} / ${pages.length} 张…`;images.push(await renderToJpeg(pages[i]));}
   const pdf=buildPdf(images,{pageWmm:210,pageHmm:297,dpi:300,title:'连续折页'});
   downloadBlob(new Blob([pdf],{type:'application/pdf'}),`连续折页-${o.size}-${o.panels}面.pdf`);status.textContent=`已导出 ${pages.length} 页 PDF。使用 A4、单面、实际尺寸100%打印，并核对50mm标尺。`;
  }catch(e){err(e.message);status.textContent='导出失败，请重试：'+e.message;}finally{busy=false;button.disabled=false;inputs.forEach(e=>e.disabled=false);}
 };
 $('#fold-builder').addEventListener('toggle',()=>{if($('#fold-builder').open&&!image.src)preview();});
 if(new URLSearchParams(location.search).get('tool')==='fold')openFold();
}
export function openFold(){document.querySelector('[data-tab="works"]').click();$('#fold-builder').open=true;$('#fold-builder').scrollIntoView({block:'start'});}
