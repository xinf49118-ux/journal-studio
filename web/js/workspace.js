import {state,serializeProject,loadProject,emit,libraryUrl} from './core.js';
import {api,downloadBlob} from './api.js';
import {makeBundle,restoreBundle,validateBundle,shelf} from './backup.js';
import {templates,templateProject} from './templates.js';
import {plannerLayouts,plannerProject,todayString} from './planner.js';
import {loadLibrary} from './library.js';
import {renderToPngBlob} from './render.js';
import {$,el,ok,err} from './ui.js';

let working=false;
let flush;
let activeWork=null;
const name=()=>$('#work-name').value.trim().slice(0,60)||'未命名作品';
async function run(fn) {
 if(working)return;
 working=true;const buttons=[...document.querySelectorAll('#tab-works button')].map(b=>[b,b.disabled]);buttons.forEach(([b])=>b.disabled=true);
 try{await fn();}catch(e){err(e.message);}finally{working=false;buttons.forEach(([b,disabled])=>b.disabled=disabled);}
}
const make=()=>makeBundle(serializeProject(),state.library,async item=>{
 const res=await fetch(libraryUrl(item));if(!res.ok)throw new Error('图片读取失败，备份未完成');return res.blob();
});
function download(bundle,title=name()){
 downloadBlob(new Blob([JSON.stringify({...bundle,name:title})],{type:'application/json'}),`${title.replace(/[<>:"/\\|?*]/g,'_')}.journal.json`);
}
async function archive(title=name()) {
 const bundle=await make();
 const record={id:crypto.randomUUID(),name:title,updatedAt:new Date().toISOString(),bundle};
 await shelf('put',record);return record;
}
async function protectDraft() {
 await flush();
 if(state.layers.length || state.background.type!=='color' || state.background.value!=='#fffdf7') await archive(`${name()} · 切换前备份`);
}
async function openBundle(bundle,title) {
 validateBundle(bundle,new Set(state.materials.items.map(m=>m.id)));
 // Validate/decode every embedded image before modifying the library or current draft.
 for(const a of bundle.assets){const bmp=await createImageBitmap(await (await fetch(a.data)).blob());bmp.close();}
 await protectDraft();
 const created=[];
 let project;
 try {
   project=await restoreBundle(bundle,async a=>{
     const r=await api.importBlob(await (await fetch(a.data)).blob(),String(a.name||'备份图片'),['备份恢复']);
     created.push(r.item.id);return r.item.id;
   },new Set(state.materials.items.map(m=>m.id)));
 }catch(e){for(const id of created)await api.deleteLibraryItem(id).catch(()=>{});throw e;}
 await loadLibrary();loadProject(project);$('#work-name').value=title||'恢复的作品';activeWork=null;emit('changed');
 document.querySelector('[data-tab="editor"]').click();ok('作品已打开，原草稿已保留在作品库');
}
async function renderWorks() {
 const box=$('#works-grid');box.replaceChildren();
 const records=(await shelf('list')).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 if(!records.length){box.append(el('p',{class:'muted',text:'还没有收藏作品。完成一页后，点击「存为新作品」。作品保存在这台设备，换电脑前请导出备份。'}));return;}
 for(const record of records){
  const card=el('article',{class:'work-card'});
  card.append(el('h3',{text:record.name}),el('p',{class:'muted small',text:`${new Date(record.updatedAt).toLocaleString('zh-CN')} · ${record.bundle.project.layers.length} 个图层`}));
  const row=el('div',{class:'row gap6 work-actions'});
  const button=(title,fn)=>row.append(el('button',{class:'btn ghost',text:title,onclick:()=>run(fn)}));
  button('打开',async()=>{await openBundle(record.bundle,record.name);activeWork=record.id;});
  button('复制',async()=>{await shelf('put',{...structuredClone(record),id:crypto.randomUUID(),name:record.name+' · 副本',updatedAt:new Date().toISOString()});await renderWorks();});
  button('备份',()=>download(record.bundle,record.name));
  button('删除',async()=>{if(!confirm(`删除作品「${record.name}」？已导出的备份文件不受影响。`))return;await shelf('delete',record.id);if(activeWork===record.id)activeWork=null;await renderWorks();});
  card.append(row);box.append(card);
 }
}
async function renderTemplates(){
 const box=$('#template-grid');
 for(const t of templates){
  const card=el('article',{class:'template-card'});
  const img=el('img',{alt:`${t.name}模板预览`,width:148,height:210});
  card.append(img,el('h3',{text:t.name}),el('p',{text:t.subtitle}));
  card.append(el('button',{class:'btn primary',text:'使用这套模板',onclick:()=>run(async()=>{
   await protectDraft();loadProject(templateProject(t,state.materials.items));$('#work-name').value=t.name;activeWork=null;emit('changed');
   await renderWorks();document.querySelector('[data-tab="editor"]').click();ok('每一层都可以移动、换图和改字');
  })}));box.append(card);
  const p=templateProject(t,state.materials.items);
  try{const blob=await renderToPngBlob({...p,page:{...p.page,dpi:45,bleed_mm:0,crop_marks:false}});img.src=URL.createObjectURL(blob);}catch(e){img.alt='预览暂不可用 · 点击使用模板';}
 }
}
function initPlanner() {
 const form=$('#planner-options'),preview=$('#planner-preview'),status=$('#planner-status'),apply=$('#apply-planner');
 let theme=templates[0].id,revision=0,previewUrl=null;
 const date=todayString();$('#planner-month').value=date.slice(0,7);$('#planner-date').value=date;
 for(const layout of plannerLayouts)$('#planner-layout').append(el('option',{value:layout.id,text:layout.name}));
 const options=()=>({layout:$('#planner-layout').value,theme,month:$('#planner-month').value,date:$('#planner-date').value,weekStart:$('#planner-week-start').value,undated:$('#planner-undated').checked});
 async function refresh() {
  const ticket=++revision,o=options(),monthly=['monthly','habits'].includes(o.layout);
  $('#planner-month-field').hidden=!monthly;$('#planner-date-field').hidden=monthly;
  $('#planner-week-field').hidden=!['monthly','weekly'].includes(o.layout);
  $('#planner-month').disabled=o.undated;$('#planner-date').disabled=o.undated;
  $('#planner-date-label').textContent=o.layout==='weekly'?'这一周中的任意一天':'记录日期';
  apply.disabled=true;preview.hidden=true;status.textContent='正在排好这一页…';
  $('#planner-description').textContent=plannerLayouts.find(l=>l.id===o.layout).subtitle;
  try {
   const p=plannerProject(o,state.materials.items);
   const blob=await renderToPngBlob({...p,page:{...p.page,dpi:100}});
   if(ticket!==revision)return;
   const url=URL.createObjectURL(blob);if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=url;
   preview.src=url;preview.hidden=false;preview.alt=`${templates.find(t=>t.id===theme).name} · ${plannerLayouts.find(l=>l.id===o.layout).name}内页预览`;
   status.textContent='A5 · 白底省墨 · 文字与格线均可编辑';apply.disabled=working;
  } catch(e) {if(ticket===revision){status.textContent=e.message;apply.disabled=true;}}
 }
 for(const t of templates){
  const button=el('button',{type:'button',class:'theme-choice',text:t.name,'aria-pressed':String(t.id===theme),onclick:()=>{
   theme=t.id;for(const b of $('#planner-themes').children)b.setAttribute('aria-pressed',String(b===button));refresh();
  }});button.style.setProperty('--theme-color',t.accent);$('#planner-themes').append(button);
 }
 form.addEventListener('submit',e=>e.preventDefault());form.addEventListener('change',refresh);
 apply.onclick=()=>run(async()=>{
  // Capture the exact selected page before saving the previous draft.
  const o=options(),project=plannerProject(o,state.materials.items);
  await protectDraft();loadProject(project);
  const layout=plannerLayouts.find(l=>l.id===o.layout).name;
  $('#work-name').value=`${templates.find(t=>t.id===o.theme).name} · ${layout}${o.undated?' · 无日期':' · '+(['monthly','habits'].includes(o.layout)?o.month:o.date)}`;
  activeWork=null;emit('changed');await renderWorks();document.querySelector('[data-tab="editor"]').click();
  ok('内页已创建，可以改字、添加贴纸或导出打印');
 }).finally(()=>{apply.disabled=preview.hidden;});
 refresh();
}
export function initWorkspace(flushDraft) {
 flush=flushDraft;
 $('#save-new-work').onclick=()=>run(async()=>{await flush();const r=await archive();activeWork=r.id;await renderWorks();ok('已存为独立作品，图片也已一起保存');});
 $('#update-work').onclick=()=>run(async()=>{
  if(!activeWork)throw new Error('请先从作品库打开一份作品，或存为新作品');
  await flush();await shelf('put',{id:activeWork,name:name(),updatedAt:new Date().toISOString(),bundle:await make()});await renderWorks();ok('作品已更新');
 });
 $('#export-backup').onclick=()=>run(async()=>{download(await make());ok('备份已导出，包含当前作品和使用的图片');});
 $('#import-backup').onclick=()=>$('#backup-file').click();
 $('#backup-file').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  await run(async()=>{if(file.size>100_000_000)throw new Error('备份超过 100MB，请拆分作品');const b=JSON.parse(await file.text());await openBundle(b,b.name);await renderWorks();});
 };
 document.querySelector('[data-tab="works"]').addEventListener('click',()=>renderWorks().catch(e=>err(e.message)));
 initPlanner();renderTemplates();renderWorks().catch(e=>err(e.message));
}
