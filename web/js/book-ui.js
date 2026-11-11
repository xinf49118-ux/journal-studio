import {bookPlan,bookPage,bookPrintPage,bookSizes,bookTypes} from './book.js';
import {exportBook} from './book-export.js';
import {templates} from './templates.js';
import {renderToPngBlob} from './render.js';
import {downloadBlob} from './api.js';
import {$,el} from './ui.js';
export function initBook(openPage){
 const form=$('#book-options'),status=$('#book-status'),preview=$('#book-preview'),select=$('#book-page'),button=$('#book-export'),edit=$('#book-edit');
 let plan=null,revision=0,url=null,busy=false,controller=null;
 for(const [value,text] of Object.entries(bookSizes))$('#book-size').append(el('option',{value,text}));
 for(const [value,text] of Object.entries(bookTypes))$('#book-type').append(el('option',{value,text}));$('#book-type').value='weekly';
 for(const t of templates)$('#book-theme').append(el('option',{value:t.id,text:t.name}));$('#book-theme').value='garden';
 const year=new Date().getFullYear();$('#book-year').value=year;$('#book-start').value=year+'-01-01';$('#book-end').value=year+'-12-31';
 const options=()=>({mode:$('#book-mode').value,year:$('#book-year').value,start:$('#book-start').value,end:$('#book-end').value,type:$('#book-type').value,size:$('#book-size').value,theme:$('#book-theme').value,weekStart:$('#book-week').value,front:$('#book-front').checked,notes:Number($('#book-notes').value),title:$('#book-title').value,paper:$('#book-paper').value});
 function nav(){const n=Number(select.value);$('#book-prev').disabled=busy||!plan||n<=0;$('#book-next').disabled=busy||!plan||n>=plan.pages.length-1;select.disabled=busy||!plan;}
 async function show(){
  const token=++revision;button.disabled=true;edit.disabled=true;preview.hidden=true;nav();if(!plan)return;
  const p=bookPrintPage(bookPage(plan,Number(select.value)),plan.options.paper);
  try{const blob=await renderToPngBlob({...p,page:{...p.page,dpi:95}});if(token!==revision)return;
   if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);preview.src=url;preview.hidden=false;
   preview.alt=`第${Number(select.value)+1}页 · ${plan.pages[Number(select.value)].label}`;
   const o=plan.options;status.textContent=`共 ${plan.pages.length} 页 · ${o.start} 至 ${o.end} · ${bookSizes[o.size]}。${o.paper==='a4'?'每张A4放一页，按角标裁切。':'按原尺寸导出。'}单面、实际尺寸100%打印。`;
   button.disabled=busy;edit.disabled=busy;
  }catch(e){if(token===revision){status.textContent='预览失败：'+e.message;}}
 }
 function refresh(){
  $('#book-year-field').hidden=$('#book-mode').value!=='year';$('#book-range').hidden=$('#book-mode').value!=='range';
  try{plan=bookPlan(options());select.replaceChildren(...plan.pages.map((p,i)=>el('option',{value:String(i),text:`${i+1} / ${plan.pages.length} · ${p.label}`})));show();}
  catch(e){revision++;plan=null;preview.hidden=true;button.disabled=true;edit.disabled=true;select.replaceChildren();nav();status.textContent=e.message;}
 }
 form.onsubmit=e=>e.preventDefault();form.onchange=refresh;
 select.onchange=show;
 $('#book-prev').onclick=()=>{select.value=String(Number(select.value)-1);show();};$('#book-next').onclick=()=>{select.value=String(Number(select.value)+1);show();};
 edit.onclick=async()=>{if(!plan||busy)return;edit.disabled=true;try{await openPage(bookPage(plan,Number(select.value)),`${plan.options.title} · ${select.selectedOptions[0].textContent}`);}finally{edit.disabled=false;}};
 $('#book-customize').onclick=()=>{if(plan&&!busy)document.dispatchEvent(new CustomEvent('book-to-diy',{detail:structuredClone(plan)}));};
 $('#book-cancel').onclick=()=>controller?.abort();
 button.onclick=async()=>{
  if(busy||!plan)return;const snapshot=structuredClone(plan);busy=true;revision++;controller=new AbortController();
  const controls=[...form.querySelectorAll('input,select')];controls.forEach(c=>c.disabled=true);button.disabled=true;edit.disabled=true;nav();$('#book-cancel').hidden=false;
  try{const bytes=await exportBook(snapshot,{signal:controller.signal,onProgress:(n,total)=>{status.textContent=`正在排印 ${n} / ${total} 页…`;}});
   downloadBlob(new Blob([bytes],{type:'application/pdf'}),`${snapshot.options.title.replace(/[<>:"/\\|?*]/g,'_')}-${snapshot.options.size}.pdf`);
   status.textContent=`已导出 ${snapshot.pages.length} 页。请选择单面、实际尺寸100%打印；先试印一页。`;
  }catch(e){status.textContent=e.name==='AbortError'?'已取消，没有下载未完成的文件。':'导出失败：'+e.message;}
  finally{busy=false;controller=null;controls.forEach(c=>c.disabled=false);button.disabled=false;edit.disabled=false;$('#book-cancel').hidden=true;nav();}
 };
 $('#book-builder').addEventListener('toggle',()=>{if($('#book-builder').open&&!plan)refresh();});
 if(new URLSearchParams(location.search).get('tool')==='book'){document.querySelector('[data-tab="works"]').click();$('#book-builder').open=true;$('#book-builder').scrollIntoView({block:'start'});}
}
