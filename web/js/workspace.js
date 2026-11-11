import {initDiy} from './diy-ui.js';
import {state,serializeProject,loadProject,emit,libraryUrl} from './core.js';
import {api,downloadBlob} from './api.js';
import {makeBundle,restoreBundle,validateBundle,shelf} from './backup.js';
import {templates,templateProject} from './templates.js';
import {plannerLayouts,plannerProject,todayString} from './planner.js';
import {plannerGroups,kokuyoSeries} from './planner-catalog.js';
import {otherSeries,brandScope as researchScope} from './brand-catalog.js';
import {chinaSeries} from './china-catalog.js';
import {initCoverage} from './coverage.js';
import {initBook} from './book-ui.js';
import {fitProject} from './page-fit.js';
import {initFold} from './fold-ui.js';
const referenceSeries=[...kokuyoSeries.map(s=>({...s,brand:'KOKUYO'})),...otherSeries,...chinaSeries];
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
 const records=(await shelf('list')).filter(r=>r.kind!=='book').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
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
 const date=todayString();$('#planner-month').value=date.slice(0,7);$('#planner-date').value=date;$('#planner-year').value=date.slice(0,4);
 for(const group of plannerGroups)$('#planner-group').append(el('option',{value:group,text:group}));
 function fillLayouts(preferred=$('#planner-layout').value) {
  const group=$('#planner-group').value,q=$('#planner-search').value.trim().toLowerCase(),select=$('#planner-layout');select.replaceChildren();
  for(const g of plannerGroups){
   const matches=plannerLayouts.filter(l=>(!group||group===l.group)&&l.group===g&&`${l.name} ${l.subtitle}`.toLowerCase().includes(q));
   if(!matches.length)continue;const optgroup=el('optgroup',{label:g});
   for(const l of matches)optgroup.append(el('option',{value:l.id,text:l.name}));select.append(optgroup);
  }
  if([...select.options].some(o=>o.value===preferred))select.value=preferred;
  select.disabled=!select.options.length;
 }
 fillLayouts('monthly');
 const options=()=>({size:$('#planner-size').value,layout:$('#planner-layout').value,theme,month:$('#planner-month').value,date:$('#planner-date').value,year:$('#planner-year').value,weekStart:$('#planner-week-start').value,undated:$('#planner-undated').checked});
 async function refresh() {
  const ticket=++revision,o=options(),layout=plannerLayouts.find(l=>l.id===o.layout);
  apply.disabled=true;preview.hidden=true;
  if(!layout){$('#planner-companion').hidden=true;status.textContent='没有匹配的内页，试试其他关键词';$('#planner-description').textContent='';return;}
  $('#planner-month-field').hidden=layout.period!=='month';$('#planner-date-field').hidden=!['week','day'].includes(layout.period);$('#planner-year-field').hidden=layout.period!=='year';
  $('#planner-week-field').hidden=!(layout.period==='week'||['monthly','monthly_grid','monthly_log','annual_calendar','dual_month'].includes(o.layout));
  $('#planner-undated-choice').hidden=layout.period==='none';
  $('#planner-month').disabled=o.undated;$('#planner-date').disabled=o.undated;$('#planner-year').disabled=o.undated;
  $('#planner-date-label').textContent=layout.period==='week'?'起始周中的任意一天':'记录日期';
  apply.disabled=true;preview.hidden=true;status.textContent='正在排好这一页…';
  $('#planner-description').textContent=layout.subtitle;
  const companion=$('#planner-companion');companion.hidden=!layout.companion;
  companion.onclick=()=>choose(layout.companion);
  try {
   const p=fitProject(plannerProject(o,state.materials.items),o.size);
   const blob=await renderToPngBlob({...p,page:{...p.page,dpi:100}});
   if(ticket!==revision)return;
   const url=URL.createObjectURL(blob);if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=url;
   preview.src=url;preview.hidden=false;preview.alt=`${templates.find(t=>t.id===theme).name} · ${plannerLayouts.find(l=>l.id===o.layout).name}内页预览`;
   status.textContent=`${o.size} · 等比适配 · 文字与格线可编辑，小尺寸建议先试印`; apply.disabled=working;
  } catch(e) {if(ticket===revision){status.textContent=e.message;apply.disabled=true;}}
 }
 for(const t of templates){
  const button=el('button',{type:'button',class:'theme-choice',text:t.name,'aria-pressed':String(t.id===theme),onclick:()=>{
   theme=t.id;for(const b of $('#planner-themes').children)b.setAttribute('aria-pressed',String(b===button));refresh();
  }});button.style.setProperty('--theme-color',t.accent);$('#planner-themes').append(button);
 }
 form.addEventListener('submit',e=>e.preventDefault());form.addEventListener('change',e=>{if(e.target.id==='planner-group')fillLayouts();refresh();});
 $('#planner-search').addEventListener('input',()=>{fillLayouts();refresh();});
 apply.onclick=()=>run(async()=>{
  // Capture the exact selected page before saving the previous draft.
  const o=options(),project=fitProject(plannerProject(o,state.materials.items),o.size);
  await protectDraft();loadProject(project);
  const layout=plannerLayouts.find(l=>l.id===o.layout);
  const suffix=layout.period==='none'?'':o.undated?' · 无日期':' · '+({month:o.month,year:o.year,day:o.date,week:o.date}[layout.period]);
  $('#work-name').value=`${templates.find(t=>t.id===o.theme).name} · ${layout.name}${suffix}`;
  activeWork=null;emit('changed');await renderWorks();document.querySelector('[data-tab="editor"]').click();
  ok('内页已创建，可以改字、添加贴纸或导出打印');
 }).finally(()=>{apply.disabled=preview.hidden;});
 const choose=id=>{
  $('#planner-group').value='';$('#planner-search').value='';fillLayouts(id);refresh();
  document.querySelector('[data-tab="works"]').click();$('#tab-works').scrollTo({top:0});
 };
 refresh();
 initReference(choose);
 initCoverage(choose);
 const requested=new URLSearchParams(location.search).get('layout');
 if(plannerLayouts.some(l=>l.id===requested))choose(requested);
 else if(new URLSearchParams(location.search).get('tab')==='coverage')document.querySelector('[data-tab="coverage"]').click();
 $('#planner-total').textContent=`${plannerLayouts.length} 种内页`;
}
function initReference(choose) {
 $('#reference-summary').textContent=researchScope.summary;$('#reference-limit').textContent=researchScope.limit;$('#reference-adaptation').textContent=researchScope.adaptation;
 for(const brand of [...new Set(referenceSeries.map(s=>s.brand))])$('#reference-brand').append(el('option',{value:brand,text:brand}));
 for(const family of [...new Set(referenceSeries.map(s=>s.family))])$('#reference-family').append(el('option',{value:family,text:family}));
 function render(){
  const q=$('#reference-search').value.trim().toLowerCase(),family=$('#reference-family').value;
  const brand=$('#reference-brand').value;
  const items=referenceSeries.filter(s=>(!brand||s.brand===brand)&&(!family||s.family===family)&&`${s.name} ${s.description} ${s.status} ${s.layouts.map(id=>plannerLayouts.find(l=>l.id===id)?.name).join(' ')}`.toLowerCase().includes(q));
  const box=$('#reference-grid');box.replaceChildren();$('#reference-count').textContent=`显示 ${items.length} / ${referenceSeries.length} 项参考 · 核实于 ${researchScope.checked}`;
  for(const s of items){
   const card=el('article',{class:'reference-card'});
   card.append(el('p',{class:'eyebrow',text:`${s.family} / ${s.status}`}),el('h2',{text:s.name}),el('p',{text:s.description}),el('p',{class:'muted small',text:s.variants}));
   const links=el('div',{class:'reference-links'});links.append(el('a',{href:s.url,target:'_blank',rel:'noopener noreferrer',text:'查看来源 ↗'}));
   if(s.extraUrl)links.append(el('a',{href:s.extraUrl,target:'_blank',rel:'noopener noreferrer',text:'补充来源 ↗'}));card.append(links);
   const choices=el('div',{class:'reference-layouts'});
   for(const id of s.layouts){const l=plannerLayouts.find(l=>l.id===id);choices.append(el('button',{class:'btn ghost',text:l.name,onclick:()=>choose(id)}));}
   card.append(choices);box.append(card);
  }
  if(!items.length)box.append(el('p',{class:'muted',text:'没有找到对应系列，试试清空关键词或切换分类。'}));
 }
 $('#reference-brand').addEventListener('change',()=>{$('#reference-family').value='';render();});
 $('#reference-search').addEventListener('input',render);$('#reference-family').addEventListener('change',render);render();
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
 initDiy({capture:make,open:openBundle});initPlanner();initFold();initBook((p,title)=>run(async()=>{await protectDraft();loadProject(p);$('#work-name').value=title;activeWork=null;emit('changed');await renderWorks();document.querySelector('[data-tab="editor"]').click();ok('这一页已作为独立作品打开，可改字与添加贴纸');}));renderTemplates();renderWorks().catch(e=>err(e.message));
}
