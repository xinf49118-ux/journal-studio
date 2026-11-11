import {initBookManager} from './book-manager.js';
import {changeBook,reorderPages} from './book-history.js';
import {customSize,imposePages} from './print-layout.js';
import {fitProject} from './page-fit.js';
import {state} from './core.js';
import {shelf,commitBook} from './backup.js';
import {plannerLayouts,plannerProject,todayString} from './planner.js';
import {bookPage} from './book.js';
import {validateDiy,diyPages} from './diy.js';
import {renderToPngBlob,renderToJpeg} from './render.js';
import {buildPdf} from './pdf.js';
import {pageDims} from './core.js';
import {downloadBlob} from './api.js';
import {$,el} from './ui.js';
const uuid=()=>crypto.randomUUID(),blank=size=>({version:1,page:{size,orientation:'portrait',dpi:300,bleed_mm:0,crop_marks:false},background:{type:'color',value:'#ffffff',tile:false},layers:[]});
const bundle=project=>({format:'journal-studio-backup',version:1,project,assets:[]});
export function initDiy({capture,open}){
 let savedRecord=null,manager=null,doc=null,key=null,editing=null,busy=false,revision=0,url=null,controller=null;
 const status=$('#diy-status'),selection=$('#diy-page');
 const remember=()=>{try{if(editing)sessionStorage.setItem('journal-diy-editing',JSON.stringify(editing));else sessionStorage.removeItem('journal-diy-editing');}catch{}};
 try{const saved=JSON.parse(sessionStorage.getItem('journal-diy-editing')||'null');if(saved?.token&&saved.token===state.page.diy_session){editing=saved;$('#diy-return').hidden=false;$('#diy-discard').hidden=false;}}catch{}
 const ids=()=>new Set(state.materials.items.map(m=>m.id));
 const current=()=>doc?.pages[Number(selection.value)];
 const settingIds=['paper','holes','gap','group-gap','edge','diameter','offsets','toc','numbers'];
 const settings=()=>Object.fromEntries(settingIds.map(id=>[id,$('#diy-'+id).type==='checkbox'?$('#diy-'+id).checked:$('#diy-'+id).value]));const defaults=settings();
 async function library(){const rows=(await shelf('list')).filter(r=>r.kind==='book');$('#diy-library').replaceChildren(...rows.map(r=>el('option',{value:r.id,text:r.doc.title})));if(key)$('#diy-library').value=key;}
 async function persist(next,newKey=key,options={}){validateDiy(next,ids());const previous=options.previous??(newKey===key?savedRecord:null),record=changeBook(previous,next,options);record.id=newKey;validateDiy(record.doc,ids());await commitBook(record,previous?.revision||0);savedRecord=record;doc=record.doc;key=newKey;await library();}
 function controls(){for(const e of document.querySelectorAll('#diy-builder button,#diy-builder input,#diy-builder select'))e.disabled=busy;$('#diy-cancel').disabled=false;$('#diy-return').disabled=busy;manager?.controls();}
 async function guard(fn){if(busy)return;busy=true;controls();try{await fn();}catch(e){status.textContent='未完成：'+e.message;}finally{busy=false;controls();}}
 async function show(index=Number(selection.value)||0){
  for(const [id,value] of Object.entries({...defaults,...doc.printSettings})){if(!settingIds.includes(id))continue;const input=$('#diy-'+id);if(input.type==='checkbox')input.checked=!!value;else input.value=value;}
  const token=++revision;$('#diy-title').value=doc.title;$('#diy-size').value=doc.size;$('#diy-custom-fields').hidden=doc.size!=='Custom';if(doc.size==='Custom'){$('#diy-width').value=doc.width_mm;$('#diy-height').value=doc.height_mm;}
  selection.replaceChildren(...doc.pages.map((p,i)=>el('option',{value:String(i),text:`${i+1} · ${p.name}`})));selection.value=String(Math.max(0,Math.min(index,doc.pages.length-1)));
  const p=current();$('#diy-name').value=p?.name||'';$('#diy-preview').hidden=true;
  status.textContent=`${doc.title} · ${doc.pages.length} 页 · 已保存于当前浏览器`;
  manager?.update();
  if(!p)return;
  const request=diyPages({...doc,pages:[p]},{toc:false,numbers:false})[0];const image=await renderToPngBlob({...request,page:{...request.page,dpi:85}});if(token!==revision)return;
  if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(image);$('#diy-preview').src=url;$('#diy-preview').hidden=false;
 }
 const noEditing=()=>{if(editing)throw new Error('请先点顶部「保存回整册」，再调整或切换整册');};
 async function fresh(pages=[]){noEditing();const next={format:'journal-studio-book',version:1,title:'我的DIY手账',size:'A5',pages};await persist(next,'book-'+uuid());await show();}
 async function mutate(fn){noEditing();if(!doc)await fresh();const next=structuredClone(doc);const target=fn(next);await persist(next);await show(typeof target==='number'?target:undefined);}
 for(const l of plannerLayouts)$('#diy-template').append(el('option',{value:l.id,text:l.name}));
 $('#diy-new').onclick=()=>guard(()=>fresh());
 $('#diy-library').onchange=()=>guard(async()=>{noEditing();const row=(await shelf('list')).find(r=>r.id===$('#diy-library').value);validateDiy(row.doc,ids());doc=row.doc;savedRecord=row;key=row.id;await show();});
 $('#diy-title').onchange=()=>guard(()=>mutate(d=>d.title=$('#diy-title').value.trim()||'我的DIY手账'));
 $('#diy-size').onchange=()=>guard(()=>mutate(d=>{d.size=$('#diy-size').value;if(d.size==='Custom'){d.width_mm=Number($('#diy-width').value);d.height_mm=Number($('#diy-height').value);}}));
 for(const id of ['width','height'])$('#diy-'+id).onchange=()=>guard(()=>mutate(d=>{d.width_mm=Number($('#diy-width').value);d.height_mm=Number($('#diy-height').value);}));
 for(const id of settingIds)$('#diy-'+id).onchange=()=>guard(()=>mutate(d=>d.printSettings=settings()));
 selection.onchange=()=>guard(()=>show());
 $('#diy-name').onchange=()=>guard(()=>mutate(d=>{if(current())d.pages[Number(selection.value)].name=$('#diy-name').value.trim()||'未命名页';}));
 $('#diy-add').onclick=()=>guard(()=>mutate(d=>{const layout=$('#diy-template').value,date=todayString();d.pages.push({id:uuid(),name:plannerLayouts.find(l=>l.id===layout)?.name||'空白自由页',bundle:bundle(layout==='blank'?{...blank(d.size),page:{...blank(d.size).page,...customSize(d.size,d.width_mm,d.height_mm)}}:plannerProject({layout,date,month:date.slice(0,7)},state.materials.items))});}));
 $('#diy-capture').onclick=()=>guard(async()=>{const b=await capture();await mutate(d=>d.pages.push({id:uuid(),name:'我的设计页',bundle:b}));});
 for(const [id,fn] of Object.entries({copy:(d,i)=>d.pages.splice(i+1,0,{...structuredClone(d.pages[i]),id:uuid(),name:d.pages[i].name+' 副本'}),up:(d,i)=>{if(i>0)[d.pages[i-1],d.pages[i]]=[d.pages[i],d.pages[i-1]];},down:(d,i)=>{if(i<d.pages.length-1)[d.pages[i+1],d.pages[i]]=[d.pages[i],d.pages[i+1]];},delete:(d,i)=>d.pages.splice(i,1)}))$('#diy-'+id).onclick=()=>guard(async()=>{if(!current())return;if(id==='delete'&&!confirm('删除选中页？删除前可先导出整册备份。'))return;await mutate(d=>fn(d,Number(selection.value)));});
 $('#diy-edit').onclick=()=>guard(async()=>{noEditing();const p=current();if(!p)return;const token=uuid(),b=structuredClone(p.bundle);b.project=fitProject(b.project,customSize(doc.size,doc.width_mm,doc.height_mm),'portrait');b.project.page.diy_session=token;await open(b,`${doc.title} · ${p.name}`);editing={key,page:p.id,token,revision:savedRecord?.revision||0};remember();$('#diy-return').hidden=false;$('#diy-discard').hidden=false;});
 $('#diy-return').onclick=()=>guard(async()=>{if(!editing)return;const captured=await capture();if(captured.project.page.diy_session!==editing.token)throw new Error('当前编辑页已切换；可退出整册编辑后，将当前页作为新页加入');delete captured.project.page.diy_session;const record=(await shelf('list')).find(r=>r.id===editing.key);if(!record)throw new Error('未找到原手账，请先导出当前页备份');if(editing.revision!==undefined&&(record.revision||0)!==editing.revision)throw new Error('整册已在其他窗口更新，请先备份当前编辑页，再退出整册编辑重新打开');const next=structuredClone(record.doc),p=next.pages.find(p=>p.id===editing.page);if(!p)throw new Error('原页面已移除，请先导出当前页备份');p.bundle=captured;await persist(next,editing.key,{previous:record,label:'编辑页面前'});editing=null;remember();$('#diy-return').hidden=true;$('#diy-discard').hidden=true;document.querySelector('[data-tab="works"]').click();$('#diy-builder').open=true;await show(next.pages.indexOf(p));});
 $('#diy-discard').onclick=()=>{if(confirm('退出本页的整册编辑？整册保留上次保存内容，当前编辑器草稿仍在。')){editing=null;remember();$('#diy-return').hidden=true;$('#diy-discard').hidden=true;}};
 $('#diy-backup').onclick=()=>guard(async()=>{if(!doc)return;downloadBlob(new Blob([JSON.stringify(doc)],{type:'application/json'}),doc.title+'.book.json');status.textContent='整册备份已导出，包含各页和自己的图片';});
 $('#diy-import').onclick=()=>$('#diy-file').click();
 $('#diy-file').onchange=e=>{const file=e.target.files[0];e.target.value='';if(!file)return;guard(async()=>{noEditing();if(file.size>100_000_000)throw new Error('备份超过100MB，请分册');const next=JSON.parse(await file.text());validateDiy(next,ids());const images=new Set(next.pages.flatMap(p=>p.bundle.assets.map(a=>a.data)));for(const data of images){const bitmap=await createImageBitmap(await(await fetch(data)).blob());bitmap.close();}await persist(next,'book-'+uuid());await show();});};
 const binding=()=>({holes:$('#diy-holes').value,gap:Number($('#diy-gap').value),groupGap:Number($('#diy-group-gap').value),edge:Number($('#diy-edge').value),diameter:Number($('#diy-diameter').value),offsets:$('#diy-offsets').value});
 const prepared=()=>imposePages(diyPages(doc,{toc:$('#diy-toc').checked,numbers:$('#diy-numbers').checked}),$('#diy-paper').value,binding());
 const instructions=pages=>{const [w,h]=pageDims(pages[0].page),mode=$('#diy-paper').value;return `${pages.length}个印面，${pages[0].page.size}纸 ${w}×${h}mm，实际尺寸100%。`+(mode==='booklet'?'双面短边翻转；裁切外缘后按输出顺序叠齐、沿中线对折。':mode==='a4-duplex'?'双面长边翻转；按角标裁切。':'单面打印。');};
 $('#diy-proof').onclick=()=>guard(async()=>{if(!doc?.pages.length)throw new Error('请先添加页面');$('#diy-review-mode').value='print';$('#diy-review').open=true;await manager.review(true);status.textContent='完整印面预览：'+instructions(prepared());});
 manager=initBookManager({doc:()=>doc,key:()=>key,record:()=>savedRecord,busy:()=>busy,index:()=>Number(selection.value),run:guard,paper:()=>$('#diy-paper').value,prepared,
 error:e=>status.textContent='预览未完成：'+e.message,
 select:i=>show(i),
 history:async(mode,index)=>{noEditing();if(!doc)return;await persist(doc,key,{mode,index});await show();},
 move:async(ids,before)=>{if(!ids.length)throw new Error('请先选择页面');await mutate(d=>{d.pages=reorderPages(d.pages,ids,before);return d.pages.findIndex(p=>p.id===ids[0]);});},
 copy:async(ids)=>{if(!ids.length)throw new Error('请先选择页面');await mutate(d=>{const selected=new Set(ids);d.pages=d.pages.flatMap(p=>selected.has(p.id)?[p,{...structuredClone(p),id:uuid(),name:p.name.slice(0,55)+' 副本'}]:[p]);});},
 remove:async(ids)=>{if(!ids.length)throw new Error('请先选择页面');await mutate(d=>d.pages=d.pages.filter(p=>!ids.includes(p.id)));}
 });
 $('#diy-cancel').onclick=()=>controller?.abort();
 async function output(print){if(editing)throw new Error('请先保存回整册');if(!doc?.pages.length)throw new Error('请先添加页面');
  let win=print?window.open('about:blank','_blank'):null;controller=new AbortController();$('#diy-cancel').hidden=false;
  try{const pages=prepared(),images=[];let bytes=0;
   for(let i=0;i<pages.length;i++){if(controller.signal.aborted)throw new DOMException('已取消','AbortError');const image=await renderToJpeg(pages[i]);bytes+=image.jpeg.length;if(bytes>180_000_000)throw new Error('文件过大，请分册导出');images.push(image);status.textContent=`正在输出 ${i+1} / ${pages.length} 页`;await new Promise(r=>setTimeout(r,0));}
   if(controller.signal.aborted)throw new DOMException('已取消','AbortError');const [w,h]=pageDims(pages[0].page),pdf=new Blob([buildPdf(images,{pageWmm:w,pageHmm:h,title:doc.title})],{type:'application/pdf'});
   if(win){const printUrl=URL.createObjectURL(pdf);win.location.href=printUrl;setTimeout(()=>URL.revokeObjectURL(printUrl),300000);}else downloadBlob(pdf,doc.title+'.pdf');status.textContent=(print?'打印PDF已打开。':'整册PDF已导出。')+instructions(pages);
  }catch(e){if(win)win.close();throw e;}finally{controller=null;$('#diy-cancel').hidden=true;}
 }
 $('#diy-export').onclick=()=>guard(()=>output(false));$('#diy-print').onclick=()=>guard(()=>output(true));
 document.addEventListener('book-to-diy',e=>guard(async()=>{noEditing();const plan=e.detail,pages=plan.pages.flatMap((p,i)=>{if(p.kind==='contents')return [];const project=bookPage(plan,i);project.layers=project.layers.filter(l=>!(l.kind==='text'&&l.text===`${i+1} / ${plan.pages.length}`));return [{id:uuid(),name:p.label,bundle:bundle(project)}];});await persist({format:'journal-studio-book',version:1,title:plan.options.title,size:plan.options.size,pages},'book-'+uuid());$('#diy-builder').open=true;await show();$('#diy-builder').scrollIntoView({block:'start'});}));
 $('#diy-builder').addEventListener('toggle',()=>{if($('#diy-builder').open&&!doc)guard(async()=>{await library();const row=(await shelf('list')).filter(r=>r.kind==='book').sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt)).at(-1);if(row){validateDiy(row.doc,ids());doc=row.doc;savedRecord=row;key=row.id;await show();}else await fresh();});});
 if(new URLSearchParams(location.search).get('tool')==='diy'){document.querySelector('[data-tab="works"]').click();$('#diy-builder').open=true;$('#diy-builder').scrollIntoView({block:'start'});}
}
