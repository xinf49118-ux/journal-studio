import {validateBundle} from './backup.js';
import {fitProject} from './page-fit.js';
import {PAGE_SIZES,makeTextLayer} from './core.js';
import {bookPrintPage} from './book.js';
export function validateDiy(doc,ids){
 if(doc?.format!=='journal-studio-book'||doc.version!==1||!['A5','A6','B6','Weeks'].includes(doc.size)||typeof doc.title!=='string'||doc.title.length>100||!Array.isArray(doc.pages)||doc.pages.length>500)throw new Error('整册备份格式或页数无效（最多500页）');
 const seen=new Set();for(const p of doc.pages){if(typeof p.id!=='string'||seen.has(p.id)||typeof p.name!=='string'||p.name.length>100)throw new Error('整册页面信息无效');seen.add(p.id);validateBundle(p.bundle,ids);}return doc;
}
export function diyPages(doc,{toc=true,numbers=true,paper='native'}={}){
 const [w,h]=PAGE_SIZES[doc.size],count=toc?Math.ceil(doc.pages.length/20):0,total=count+doc.pages.length;
 const pages=[];
 for(let i=0;i<count;i++){
  const layers=[makeTextLayer({text:'我的手账 · 目录',x_mm:8,y_mm:12,size_mm:4,color:'#537558'})];
  doc.pages.slice(i*20,i*20+20).forEach((p,j)=>{layers.push(makeTextLayer({text:p.name.slice(0,Math.floor((w-34)/2.6)),x_mm:8,y_mm:27+j*(h-45)/20,size_mm:2.6,color:'#537558'}),makeTextLayer({text:String(count+i*20+j+1),x_mm:w-20,y_mm:27+j*(h-45)/20,size_mm:2.6,color:'#537558'}));});
  pages.push({version:1,page:{size:doc.size,orientation:'portrait',dpi:300,bleed_mm:0,crop_marks:false},background:{type:'color',value:'#ffffff',tile:false},layers});
 }
 for(const p of doc.pages){const project=fitProject(p.bundle.project,doc.size,'portrait');project.page={...project.page,orientation:'portrait',dpi:300,bleed_mm:0,crop_marks:false};project.embeddedAssets=Object.fromEntries(p.bundle.assets.map(a=>[a.id,a.data]));pages.push(project);}
 return pages.map((p,i)=>{if(numbers)p.layers.push(makeTextLayer({text:`${i+1} / ${total}`,x_mm:w-24,y_mm:h-5,size_mm:2.2,color:'#666666'}));return bookPrintPage(p,paper);});
}
