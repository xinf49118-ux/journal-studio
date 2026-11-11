const snapshot=(doc,label)=>({doc:structuredClone(doc),at:new Date().toISOString(),label});
function bound(list){const out=[...list];let bytes=out.reduce((n,x)=>n+JSON.stringify(x).length*2,0);while(out.length>1&&(out.length>12||bytes>20_000_000))bytes-=JSON.stringify(out.shift()).length*2;return out;}
export function changeBook(previous,next,{mode='edit',index,label='修改整册'}={}){
 const history=previous?.history||{past:[],future:[]};let past=[...history.past],future=[...history.future],doc=next;
 if(mode==='undo'){if(!past.length)throw new Error('没有可撤销的整册修改');doc=past.pop().doc;future.push(snapshot(previous.doc,'撤销前的版本'));}
 else if(mode==='redo'){if(!future.length)throw new Error('没有可重做的整册修改');doc=future.pop().doc;past.push(snapshot(previous.doc,'重做前的版本'));}
 else if(mode==='restore'){if(!Number.isInteger(index)||!past[index])throw new Error('历史版本不存在');doc=past[index].doc;past.push(snapshot(previous.doc,'恢复历史前的版本'));future=[];}
 else if(previous&&JSON.stringify(previous.doc)!==JSON.stringify(next)){past.push(snapshot(previous.doc,label));future=[];}
 return {id:previous?.id,kind:'book',name:doc.title,doc:structuredClone(doc),revision:(previous?.revision||0)+1,updatedAt:new Date().toISOString(),history:{past:bound(past),future:bound(future)}};
}
export function reorderPages(pages,ids,beforeId=null){
 const selected=new Set(ids);if(!selected.size||ids.some(id=>!pages.some(p=>p.id===id)))throw new Error('未找到要移动的页面');
 if(beforeId&&selected.has(beforeId))return [...pages];
 const moving=pages.filter(p=>selected.has(p.id)),rest=pages.filter(p=>!selected.has(p.id)),index=beforeId===null?rest.length:rest.findIndex(p=>p.id===beforeId);
 if(index<0)throw new Error('目标页面不存在');rest.splice(index,0,...moving);return rest;
}
export function readingSpreads(length){const out=[];if(length)out.push([null,0]);for(let i=1;i<length;i+=2)out.push([i,i+1<length?i+1:null]);return out;}
export function printSpreads(length,mode){return mode==='a4-duplex'||mode==='booklet'?Array.from({length:Math.ceil(length/2)},(_,i)=>[2*i,2*i+1<length?2*i+1:null]):Array.from({length},(_,i)=>[i,null]);}
