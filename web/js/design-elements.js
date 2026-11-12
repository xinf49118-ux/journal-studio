import {advancedTypes,advancedPresets,advancedElement} from './advanced-elements.js';
import {planningTypes,planningPresets,planningElement} from './planning-elements.js';
import {makeShapeLayer,makeTextLayer,uid} from './core.js';
export const elementTypes={...planningTypes,...advancedTypes,hline:'横线',vline:'竖线',frame:'分区框',ellipse:'椭圆框',rules:'横线书写区',grid:'方格区',dots:'点阵区',table:'表格',checklist:'待办清单',timeline:'时间轴',text:'标题文字'};
const finite=(n,name,min,max)=>{n=Number(n);if(!Number.isFinite(n)||n<min||n>max)throw new Error(`${name}需在${min}—${max}之间`);return n;};
export function designLine(x1,y1,x2,y2,{color='#7d8980',stroke=.25,dashed=false}={}){
 if(![x1,y1,x2,y2].every(Number.isFinite)||!/^#[0-9a-f]{6}$/i.test(color))throw new Error('线条位置或颜色无效');stroke=finite(stroke,'线宽',.1,2);
 const length=Math.hypot(x2-x1,y2-y1);if(length<.3)throw new Error('线条太短，请拖动更远一点');
 const angle=Math.atan2(y2-y1,x2-x1),layers=[],step=length;
 if(dashed){const cx=(x1+x2)/2,cy=(y1+y2)/2;return [{...makeShapeLayer({shape:'line',x_mm:cx-length/2,y_mm:cy-stroke/2,w_mm:length,h_mm:stroke,fill:color,stroke_mm:stroke}),rotate:-angle*180/Math.PI,dash_mm:2,gap_mm:2,design_role:'stroke',name:'虚线'}];}
 for(let d=0;d<length;d+=step){const len=Math.min(dashed?2:length,length-d),cx=x1+Math.cos(angle)*(d+len/2),cy=y1+Math.sin(angle)*(d+len/2);layers.push({...makeShapeLayer({x_mm:cx-len/2,y_mm:cy-stroke/2,w_mm:len,h_mm:stroke,fill:color}),rotate:-angle*180/Math.PI,design_role:'stroke',name:'线条'});}
 return layers;
}
export function designElement(o={}){
 if(planningTypes[o.type]){const options={...planningPresets[o.type],...o};return configured(planningElement(options,{line:designLine}),options);}
 if(advancedTypes[o.type]){const options={...advancedPresets[o.type],...o};return configured(advancedElement(options,{line:designLine}),options);}
 const {type='frame',color='#7d8980',dashed=false,text='我的标题'}=o;if(!elementTypes[type])throw new Error('请选择可用的设计元素');if(!/^#[0-9a-f]{6}$/i.test(color))throw new Error('请选择有效颜色');
 const x=finite(o.x??12,'横向位置',0,420),y=finite(o.y??45,'纵向位置',0,420),w=finite(o.w??100,'宽度',1,400),h=finite(o.h??60,'高度',1,400),stroke=finite(o.stroke??.25,'线宽',.1,2),gap=finite(o.gap??7,'间距',1,40),rows=finite(o.rows??7,'行数',1,40),cols=finite(o.cols??3,'列数',1,20);
 if(!Number.isInteger(rows)||!Number.isInteger(cols))throw new Error('行列数需要整数');
 const layers=[],line=(a,b,c,d)=>layers.push(...designLine(a,b,c,d,{color,stroke,dashed})),frame=(a,b,c,d)=>{line(a,b,a+c,b);line(a,b+d,a+c,b+d);line(a,b,a,b+d);line(a+c,b,a+c,b+d);};
 if(type==='hline')line(x,y,x+w,y);else if(type==='vline')line(x,y,x,y+h);
 else if(type==='frame')frame(x,y,w,h);
 else if(type==='ellipse')layers.push(makeShapeLayer({shape:'ellipse',x_mm:x,y_mm:y,w_mm:w,h_mm:h,fill:'#ffffff00',stroke:color,stroke_mm:stroke}));
 else if(type==='text')layers.push(makeTextLayer({text:String(text).slice(0,300),x_mm:x,y_mm:y,size_mm:finite(o.fontSize??5,'字号毫米',2,20),color}));
 else if(type==='rules'||type==='grid'||type==='dots'){
  const nx=Math.floor(w/gap),ny=Math.floor(h/gap);if(type==='dots'&&(nx+1)*(ny+1)>800)throw new Error('点阵过密，请增大间距');
  for(let r=0;r<=ny;r++)if(type==='dots'){for(let c=0;c<=nx;c++)layers.push(makeShapeLayer({shape:'ellipse',x_mm:x+c*gap,y_mm:y+r*gap,w_mm:stroke*2,h_mm:stroke*2,fill:color}));}else line(x,y+r*gap,x+w,y+r*gap);
  if(type==='grid')for(let c=0;c<=nx;c++)line(x+c*gap,y,x+c*gap,y+h);
 }else if(type==='table'){
  for(let r=0;r<=rows;r++)line(x,y+r*h/rows,x+w,y+r*h/rows);for(let c=0;c<=cols;c++)line(x+c*w/cols,y,x+c*w/cols,y+h);
 }else if(type==='checklist'){
  for(let r=0;r<rows;r++){const yy=y+r*h/rows;frame(x,yy,2.5,2.5);line(x+6,yy+3,x+w,yy+3);}
 }else if(type==='timeline'){
  const start=finite(o.startHour??8,'起始小时',0,23.75),step=finite(o.stepMinutes??60,'时间步长分钟',15,180);
  line(x+12,y,x+12,y+h);for(let r=0;r<rows;r++){const yy=y+r*h/rows,minutes=Math.round(start*60+r*step)%1440;layers.push(makeTextLayer({text:String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0'),x_mm:x,y_mm:yy,size_mm:2.5,color}));line(x+15,yy+4,x+w,yy+4);}
 }
 if(layers.length>900)throw new Error('元素太密，请减小行列数或增大间距');
 const group=uid('G');return configured(layers.map(l=>({...l,group_id:group,name:elementTypes[type]})),{type,x,y,w,h,stroke,gap,rows,cols,color,dashed,text,fontSize:o.fontSize??5,...(type==='timeline'?{startHour:Number(o.startHour??8),stepMinutes:Number(o.stepMinutes??60)}:{})});
}
export function designBox(layer,measure=l=>[Math.max(1,String(l.text||'').length*l.size_mm),l.size_mm*1.35]){
 const [w,h]=layer.kind==='text'?measure(layer):[layer.w_mm,layer.h_mm],a=(layer.rotate||0)*Math.PI/180,cx=layer.x_mm+w/2,cy=layer.y_mm+h/2,bw=Math.abs(w*Math.cos(a))+Math.abs(h*Math.sin(a)),bh=Math.abs(w*Math.sin(a))+Math.abs(h*Math.cos(a));return {x:cx-bw/2,y:cy-bh/2,w:bw,h:bh};
}
export function designBounds(layers,measure){if(!layers.length)return null;const boxes=layers.map(l=>designBox(l,measure)),x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return {x,y,w:Math.max(...boxes.map(b=>b.x+b.w))-x,h:Math.max(...boxes.map(b=>b.y+b.h))-y};}
export function alignDesign(layers,mode,{page=[148,210],measure}={}){
 const moving=layers.filter(l=>!l.locked);if(!moving.length)throw new Error('所选元素已锁定');const b=designBounds(moving,measure),axis=mode.endsWith('x')?'x':'y',size=axis==='x'?'w':'h';
 if(mode.startsWith('distribute')){
  const units=new Map();for(const l of moving){const id=l.group_id||l.id;if(!units.has(id))units.set(id,[]);units.get(id).push(l);}const groups=[...units.values()].map(items=>({items,box:designBounds(items,measure)})).sort((a,b)=>a.box[axis]-b.box[axis]);if(groups.length<3)throw new Error('等距分布至少需要三个独立元素或组合');
  const span=b[size],sum=groups.reduce((n,g)=>n+g.box[size],0),gap=(span-sum)/(groups.length-1);if(gap<0)throw new Error('当前空间不够，请先将元素拉开');let cursor=b[axis];for(const g of groups){for(const l of g.items)l[axis+'_mm']+=cursor-g.box[axis];cursor+=g.box[size]+gap;}return;
 }
 const units=new Map();for(const l of moving){const id=l.group_id||l.id;if(!units.has(id))units.set(id,[]);units.get(id).push(l);}
 for(const items of units.values()){const box=designBounds(items,measure);let dx=0,dy=0;
  if(mode==='left')dx=b.x-box.x;if(mode==='right')dx=b.x+b.w-box.x-box.w;if(mode==='center-x')dx=(moving.length===items.length?page[0]/2:b.x+b.w/2)-(box.x+box.w/2);
  if(mode==='top')dy=b.y-box.y;if(mode==='bottom')dy=b.y+b.h-box.y-box.h;if(mode==='center-y')dy=(moving.length===items.length?page[1]/2:b.y+b.h/2)-(box.y+box.h/2);
  for(const l of items){l.x_mm+=dx;l.y_mm+=dy;}
 }
}

function configured(layers,options){if(layers.length)layers[0].design_config={options:structuredClone(options),bounds:designBounds(layers.some(l=>l.kind==='shape')?layers.filter(l=>l.kind==='shape'):layers),count:layers.length};return layers;}
