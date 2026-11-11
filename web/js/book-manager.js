import {$,el} from './ui.js';
import {diyPages} from './diy.js';
import {renderToPngBlob} from './render.js';
import {readingSpreads,printSpreads} from './book-history.js';
export function initBookManager(api){
 let selected=new Set(),lastKey=null,gridPage=0,gridRevision=0,reviewRevision=0,reviewIndex=0,thumbUrls=[],reviewUrls=[],dragging=null;
 const release=urls=>urls.splice(0).forEach(u=>URL.revokeObjectURL(u));
 const doc=()=>api.doc();
 function history(fill=true){const record=api.record(),past=record?.history?.past||[];
  $('#diy-undo-book').disabled=api.busy()||!past.length;$('#diy-redo-book').disabled=api.busy()||!record?.history?.future?.length;
  if(fill)$('#diy-versions').replaceChildren(...past.map((p,i)=>el('option',{value:String(i),text:`${new Date(p.at).toLocaleString('zh-CN')} · ${p.doc.pages.length}页 · ${p.label}`})).reverse());$('#diy-restore-book').disabled=api.busy()||!past.length;
 }
 async function thumbs(){
  const d=doc();if(!d)return;const token=++gridRevision;release(thumbUrls);const grid=$('#diy-thumbnails');grid.replaceChildren();
  if(lastKey!==api.key()){selected.clear();gridPage=0;lastKey=api.key();}
  selected=new Set([...selected].filter(id=>d.pages.some(p=>p.id===id)));gridPage=Math.max(0,Math.min(gridPage,Math.ceil(d.pages.length/20)-1));
  $('#diy-grid-status').textContent=`缩略图 ${gridPage+1} / ${Math.max(1,Math.ceil(d.pages.length/20))} · 已选 ${selected.size} 页`;
  $('#diy-grid-prev').disabled=api.busy()||gridPage<=0;$('#diy-grid-next').disabled=api.busy()||(gridPage+1)*20>=d.pages.length;
  const targets=$('#diy-move-target');targets.replaceChildren(...d.pages.map(p=>el('option',{value:p.id,text:'移到「'+p.name+'」之前'})),el('option',{value:'',text:'移到末尾'}));targets.value='';
  const images=[];
  d.pages.slice(gridPage*20,gridPage*20+20).forEach((p,i)=>{
   const index=gridPage*20+i,card=el('article',{class:'diy-thumb','data-page-id':p.id,draggable:'true'}),image=el('img',{alt:`第${index+1}页 ${p.name}`,width:105,height:148});
   const checkbox=el('input',{type:'checkbox','aria-label':'选择第'+(index+1)+'页',onchange:()=>{checkbox.checked?selected.add(p.id):selected.delete(p.id);$('#diy-grid-status').textContent=`缩略图 ${gridPage+1} / ${Math.max(1,Math.ceil(d.pages.length/20))} · 已选 ${selected.size} 页`;}});checkbox.checked=selected.has(p.id);
   const open=el('button',{class:'btn ghost',text:`${index+1} · ${p.name}`,onclick:()=>api.run(()=>api.select(index))});
   card.classList.toggle('is-current',index===api.index());card.append(image,el('label',{},[checkbox,'多选']),open);
   card.ondragstart=e=>{if(api.busy()){e.preventDefault();return;}const ids=selected.has(p.id)?[...selected]:[p.id];dragging={key:api.key(),ids};e.dataTransfer.setData('application/x-journal-pages',JSON.stringify(dragging));e.dataTransfer.effectAllowed='move';};
   card.ondragover=e=>{if(dragging?.key===api.key())e.preventDefault();};card.ondrop=e=>{e.preventDefault();if(dragging?.key!==api.key())return;const ids=[...dragging.ids];dragging=null;api.run(()=>api.move(ids,p.id));};card.ondragend=()=>dragging=null;
   grid.append(card);images.push({p,image});
  });
  for(const {p,image} of images){if(token!==gridRevision)return;try{const request=diyPages({...d,pages:[p]},{toc:false,numbers:false})[0],blob=await renderToPngBlob({...request,page:{...request.page,dpi:35}});if(token!==gridRevision)return;const url=URL.createObjectURL(blob);thumbUrls.push(url);image.src=url;}catch{image.alt+=' · 预览失败，可打开编辑';}}
 }
 async function review(reset=false){
  if(!doc()||!$('#diy-review').open)return;if(reset)reviewIndex=0;const token=++reviewRevision;release(reviewUrls);
  const mode=$('#diy-review-mode').value,printing=mode==='print',pages=printing?api.prepared():diyPages(doc(),{toc:false,numbers:true}),pairs=printing?printSpreads(pages.length,api.paper()):readingSpreads(pages.length);
  reviewIndex=Math.max(0,Math.min(reviewIndex,pairs.length-1));$('#diy-review-position').replaceChildren(...pairs.map((p,i)=>el('option',{value:String(i),text:`${printing?'印面组':'跨页'} ${i+1} / ${pairs.length}`})));$('#diy-review-position').value=String(reviewIndex);
  $('#diy-review-prev').disabled=api.busy()||reviewIndex<=0;$('#diy-review-next').disabled=api.busy()||reviewIndex>=pairs.length-1;
  const box=$('#diy-review-pages');box.replaceChildren();$('#diy-review-caption').textContent=printing?'与PDF输出一致；正反面并列显示，可逐组检查。':'按阅读顺序预览；封面位于右侧，空白位置仅作跨页对照。';
  if(!pairs.length){box.append(el('p',{text:'先添加页面再预览'}));return;}
  for(const [side,index] of pairs[reviewIndex].entries()){
   const panel=el('figure'),caption=el('figcaption',{text:index===null?'空白位置':printing?`印面 ${index+1}${['a4-duplex','booklet'].includes(api.paper())?(side===0?' · 正面':' · 背面'):''}`:`第 ${index+1} 页 · ${doc().pages[index].name}`});panel.append(caption);box.append(panel);
   if(index===null){panel.append(el('div',{class:'diy-empty-page',text:'留白'}));continue;}
   const image=el('img',{alt:caption.textContent});panel.append(image);const request=pages[index],blob=await renderToPngBlob({...request,page:{...request.page,dpi:110}});if(token!==reviewRevision)return;const url=URL.createObjectURL(blob);reviewUrls.push(url);image.src=url;
  }
 }
 $('#diy-undo-book').onclick=()=>api.run(()=>api.history('undo'));$('#diy-redo-book').onclick=()=>api.run(()=>api.history('redo'));
 $('#diy-restore-book').onclick=()=>api.run(async()=>{if(confirm('恢复这个历史版本？当前版本也会保留，可撤销此次恢复。'))await api.history('restore',Number($('#diy-versions').value));});
 $('#diy-grid-prev').onclick=()=>{gridPage--;thumbs();};$('#diy-grid-next').onclick=()=>{gridPage++;thumbs();};
 $('#diy-select-visible').onclick=()=>{for(const p of doc()?.pages.slice(gridPage*20,gridPage*20+20)||[])selected.add(p.id);thumbs();};$('#diy-clear-selection').onclick=()=>{selected.clear();thumbs();};
 $('#diy-batch-copy').onclick=()=>api.run(()=>api.copy([...selected]));$('#diy-batch-delete').onclick=()=>api.run(async()=>{if(selected.size&&confirm(`删除选中的${selected.size}页？可用整册撤销恢复。`))await api.remove([...selected]);});$('#diy-batch-move').onclick=()=>api.run(()=>api.move([...selected],$('#diy-move-target').value||null));
 $('#diy-review-prev').onclick=()=>{reviewIndex--;review().catch(e=>api.error(e));};$('#diy-review-next').onclick=()=>{reviewIndex++;review().catch(e=>api.error(e));};
 $('#diy-review-position').onchange=()=>{reviewIndex=Number($('#diy-review-position').value);review().catch(e=>api.error(e));};$('#diy-review-mode').onchange=()=>review(true).catch(e=>api.error(e));
 $('#diy-review').addEventListener('toggle',()=>{if($('#diy-review').open)review().catch(e=>api.error(e));else {reviewRevision++;release(reviewUrls);}});
 const controls=()=>{history(false);$('#diy-grid-prev').disabled=api.busy()||gridPage<=0;$('#diy-grid-next').disabled=api.busy()||(gridPage+1)*20>=(doc()?.pages.length||0);$('#diy-review-prev').disabled=api.busy()||reviewIndex<=0;$('#diy-review-next').disabled=api.busy()||reviewIndex>=$('#diy-review-position').options.length-1;};
 return {update:()=>{gridPage=Math.max(0,Math.floor((api.index()||0)/20));history();thumbs().catch(e=>api.error(e));review().catch(e=>api.error(e));},controls,review};
}
