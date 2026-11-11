import {pageDims,makeShapeLayer} from './core.js';
import {bookPrintPage} from './book.js';
export function customSize(size,w,h){
 if(size!=='Custom')return {size};w=Number(w);h=Number(h);
 if(!Number.isFinite(w)||!Number.isFinite(h)||w<60||w>210||h<90||h>297||w>h)throw new Error('自定义竖版需宽60—210mm、高90—297mm，宽不大于高');
 return {size,w_mm:w,h_mm:h};
}
// Explicit centre-to-centre offsets: users measure their binder, no inferred brand compatibility.
export function holePositions(height,{holes='none',gap=19,groupGap=70,edge=8,diameter=5}={}){
 if(holes==='none')return [];if(!['two','six','custom'].includes(holes))throw new Error('孔位方案无效');
 if(holes==='custom'&&!String(arguments[1].offsets||'').trim())throw new Error('请填写各孔的中心偏移');
 gap=Number(gap);groupGap=Number(groupGap);edge=Number(edge);diameter=Number(diameter);
 if(![gap,groupGap,edge,diameter].every(Number.isFinite)||gap<=0||groupGap<0||edge<5||edge>18||diameter<2||diameter>8)throw new Error('请填写有效孔距、边距与孔径');
 const offsets=holes==='two'?[-40,40]:holes==='six'?[-groupGap/2-gap,-groupGap/2,-groupGap/2+gap,groupGap/2-gap,groupGap/2,groupGap/2+gap]:String(arguments[1].offsets||'').split(',').map(s=>Number(s.trim()));
 if(!offsets.length||offsets.length>12||offsets.some((v,i)=>!Number.isFinite(v)||(i&&v-offsets[i-1]<diameter+1)))throw new Error('孔位偏移须从上到下、逗号分隔，相邻孔不能重叠');
 return offsets.map(d=>{const y=height/2+d;if(y-diameter/2<5||y+diameter/2>height-5)throw new Error('孔位超出纸张，请缩小孔距或增加纸张高度');return {edge,y,diameter};});
}
export function bindingPage(project,options={},back=false){
 const p=structuredClone(project),[w,h]=pageDims(p.page),points=holePositions(h,options);if(!points.length)return p;
 const reserved=Math.max(...points.map(v=>v.edge+v.diameter/2))+4;
 if(reserved>w*.35)throw new Error('装订留白占用过大，请减小边距');
 const available=w-reserved,scale=Math.min(available/w,(h-10)/h),dx=(back?0:reserved)+(available-w*scale)/2,dy=(h-h*scale)/2;
 for(const l of p.layers){l.x_mm=l.x_mm*scale+dx;l.y_mm=l.y_mm*scale+dy;for(const k of ['w_mm','h_mm','size_mm','stroke_mm'])if(typeof l[k]==='number')l[k]*=scale;}
 for(const {edge,y,diameter} of points){p.layers.push(makeShapeLayer({shape:'ellipse',x_mm:(back?w-edge:edge)-diameter/2,y_mm:y-diameter/2,w_mm:diameter,h_mm:diameter,fill:'#d8d8d0'}));}
 return p;
}
function mount(source,w,h,x,y,target){
 const ids=new Map(Object.entries(source.embeddedAssets||{}).map(([id,data])=>[id,crypto.randomUUID()]));
 target.embeddedAssets??={};for(const [id,ref] of ids)target.embeddedAssets[ref]=source.embeddedAssets[id];
 for(const l of structuredClone(source.layers)){l.x_mm+=x;l.y_mm+=y;if(l.kind==='image'&&ids.has(l.ref))l.ref=ids.get(l.ref);target.layers.push(l);}
 const line=(a,b,c,d=.15)=>target.layers.push(makeShapeLayer({x_mm:a,y_mm:b,w_mm:c,h_mm:d,fill:'#999999'}));
 for(const [a,b] of [[x,y],[x+w,y],[x,y+h],[x+w,y+h]]){line(a===x?a-3:a+.5,b,2.5);line(a,b===y?b-3:b+.5,.15,2.5);}
}
export function imposePages(pages,mode='native',binding={}){
 if(!pages.length)throw new Error('没有可打印的页面');
 if(mode==='native')return pages.map(p=>bindingPage(p,binding));
 if(mode==='a4')return pages.map(p=>bookPrintPage(bindingPage(p,binding),'a4'));
 const [w,h]=pageDims(pages[0].page);
 if(pages.some(p=>pageDims(p.page)[0]!==w||pageDims(p.page)[1]!==h))throw new Error('拼版需要统一纸张尺寸');
 const sheet=(size,landscape)=>({version:1,page:{size,orientation:landscape?'landscape':'portrait',dpi:300,bleed_mm:0,crop_marks:false},background:{type:'color',value:'#ffffff',tile:false},layers:[]});
 if(mode==='a4-duplex'){
  if(w>190||h>277)throw new Error('此尺寸不适合A4裁切双面，请使用原尺寸或更小页面');
  const out=pages.map((p,i)=>{const target=sheet('A4',false);mount(bindingPage(p,binding,i%2===1),w,h,(210-w)/2,(297-h)/2,target);return target;});
  if(out.length%2)out.push(sheet('A4',false));return out;
 }
 if(mode!=='booklet')throw new Error('拼版方式无效');
 if(binding.holes&&binding.holes!=='none')throw new Error('对折装订与活页打孔请分别导出');
 const size=2*w+20<=297&&h+20<=210?'A4':'A3',[sw,sh]=size==='A4'?[297,210]:[420,297];
 if(2*w+20>sw||h+20>sh)throw new Error('此尺寸过大，无法在A3对折拼版，请缩小页面');
 const n=Math.ceil(pages.length/4)*4,out=[];
 for(let i=0;i<n/4;i++)for(const pair of [[n-1-2*i,2*i],[2*i+1,n-2-2*i]]){
  const target=sheet(size,true);pair.forEach((index,j)=>{mount(index<pages.length?pages[index]:{layers:[]},w,h,sw/2+(j-1)*w,(sh-h)/2,target);});
  target.layers.push(makeShapeLayer({x_mm:sw/2,y_mm:8,w_mm:.15,h_mm:3,fill:'#888888'}),makeShapeLayer({x_mm:sw/2,y_mm:sh-11,w_mm:.15,h_mm:3,fill:'#888888'}));out.push(target);
 }
 return out;
}
