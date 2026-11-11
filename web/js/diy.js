import {customSize} from './print-layout.js';
import {validateBundle} from './backup.js';
import {fitProject} from './page-fit.js';
import {pageDims,makeTextLayer} from './core.js';
import {bookPrintPage} from './book.js';
export function validateDiy(doc,ids){
 if(doc?.format!=='journal-studio-book'||doc.version!==1||!['A5','A6','B6','Weeks','Custom'].includes(doc.size)||typeof doc.title!=='string'||doc.title.length>100||!Array.isArray(doc.pages)||doc.pages.length>500)throw new Error('整册备份格式或页数无效（最多500页）');
 customSize(doc.size,doc.width_mm,doc.height_mm);
 const seen=new Set();for(const p of doc.pages){if(typeof p.id!=='string'||seen.has(p.id)||typeof p.name!=='string'||p.name.length>100)throw new Error('整册页面信息无效');seen.add(p.id);validateBundle(p.bundle,ids);}return doc;
}
export function diyPages(doc,{toc=true,numbers=true,paper='native'}={}){
 const target=customSize(doc.size,doc.width_mm,doc.height_mm),[w,h]=pageDims(target),rows=Math.max(1,Math.min(20,Math.floor((h-45)/5))),count=toc?Math.ceil(doc.pages.length/rows):0,total=count+doc.pages.length;
 const pages=[];
 for(let i=0;i<count;i++){
  const layers=[makeTextLayer({text:'我的手账 · 目录',x_mm:8,y_mm:12,size_mm:4,color:'#537558'})];
  doc.pages.slice(i*rows,i*rows+rows).forEach((p,j)=>{layers.push(makeTextLayer({text:p.name.slice(0,Math.floor((w-34)/2.6)),x_mm:8,y_mm:27+j*(h-45)/rows,size_mm:2.6,color:'#537558'}),makeTextLayer({text:String(count+i*rows+j+1),x_mm:w-20,y_mm:27+j*(h-45)/rows,size_mm:2.6,color:'#537558'}));});
  pages.push({version:1,page:{...target,orientation:'portrait',dpi:300,bleed_mm:0,crop_marks:false},background:{type:'color',value:'#ffffff',tile:false},layers});
 }
 for(const p of doc.pages){const project=fitProject(p.bundle.project,target,'portrait');project.page={...project.page,orientation:'portrait',dpi:300,bleed_mm:0,crop_marks:false};project.embeddedAssets=Object.fromEntries(p.bundle.assets.map(a=>[a.id,a.data]));pages.push(project);}
 return pages.map((p,i)=>{if(numbers)p.layers.push(makeTextLayer({text:`${i+1} / ${total}`,x_mm:w-24,y_mm:h-5,size_mm:2.2,color:'#666666'}));return bookPrintPage(p,paper);});
}
