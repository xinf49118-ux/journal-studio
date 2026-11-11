import {coverageEntries,brandCoverage,coverageStatuses,coverageScope,coverageChecked,filterCoverage} from './coverage-catalog.js';
import {plannerLayouts} from './planner.js';
import {$,el} from './ui.js';
import {downloadBlob} from './api.js';
import {openFold} from './fold-ui.js';
export function initCoverage(choose){
 $('#coverage-scope').textContent=coverageScope;
 for(const {brand} of brandCoverage)$('#coverage-brand').append(el('option',{value:brand,text:brand}));
 for(const [key,label] of Object.entries(coverageStatuses))$('#coverage-status').append(el('option',{value:key,text:label}));
 for(const kind of new Set(coverageEntries.map(r=>r.kind)))$('#coverage-kind').append(el('option',{value:kind,text:kind}));
 function render(){
  const brand=$('#coverage-brand').value;
  const items=filterCoverage({brand,status:$('#coverage-status').value,kind:$('#coverage-kind').value,query:$('#coverage-search').value});
  const all=coverageEntries.filter(r=>!brand||r.brand===brand);
  $('#coverage-count').textContent=`显示 ${items.length} / ${coverageEntries.length} 项核查 · ${coverageChecked} 更新`;
  const stats=$('#coverage-stats');stats.replaceChildren();
  for(const [key,label] of Object.entries(coverageStatuses))stats.append(el('button',{class:'btn coverage-stat',text:`${label} ${all.filter(r=>r.status===key).length}`,onclick:()=>{$('#coverage-status').value=key;render();}}));
  $('#coverage-limits').replaceChildren(...brandCoverage.filter(b=>!brand||b.brand===brand).map(b=>el('p',{text:`${b.brand}：${b.limit}`})));
  const grid=$('#coverage-grid');grid.replaceChildren();
  for(const r of items){
   const card=el('article',{class:'coverage-card'});card.dataset.status=r.status;card.dataset.id=r.id;
   card.append(el('p',{class:'eyebrow',text:`${r.brand} / ${r.kind}`}),el('h2',{text:r.name}),el('span',{class:'coverage-badge '+r.status,text:coverageStatuses[r.status]}),el('p',{class:'small',text:`资料依据：${r.evidence}`}));
   if(r.note)card.append(el('p',{text:r.note}));
   card.append(el('p',{class:'muted small',text:r.remaining}),el('a',{href:r.url,target:'_blank',rel:'noopener noreferrer',text:'查看依据 ↗'}));
   if(r.layouts.length){
    const choices=el('div',{class:'reference-layouts'});
    card.append(el('p',{class:'muted small',text:'工坊可用的通用功能：'}));
    for(const id of r.layouts)choices.append(el('button',{class:'btn ghost',text:plannerLayouts.find(l=>l.id===id).name,onclick:()=>choose(id)}));
    card.append(choices);
   }
   if(r.tool==='fold')card.append(el('button',{class:'btn',text:'打开连续折页打印',onclick:openFold}));
   grid.append(card);
  }
  if(!items.length)grid.append(el('p',{text:'没有匹配项，试试清空关键词或筛选条件。'}));
 }
 for(const id of ['coverage-brand','coverage-status','coverage-kind'])$('#'+id).addEventListener('change',render);
 $('#coverage-search').addEventListener('input',render);
 $('#coverage-clear').onclick=()=>{for(const id of ['brand','status','kind','search'])$('#coverage-'+id).value='';render();};
 $('#coverage-export').onclick=()=>downloadBlob(new Blob([JSON.stringify({checked:coverageChecked,scope:coverageScope,brands:brandCoverage,entries:coverageEntries},null,2)],{type:'application/json'}),'手账品牌覆盖核查-'+coverageChecked+'.json');
 render();
}
