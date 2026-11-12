import {makeShapeLayer,makeTextLayer,uid} from './core.js';
export const advancedTypes={radial:'圆盘时间轴',radial_habits:'环形习惯追踪',habit_matrix:'习惯追踪矩阵',year_pixels:'年度像素记录',gantt:'甘特进度格',quadrants:'四象限',kanban:'看板分栏',rolling_week:'滚动周任务矩阵',future_log:'未来计划分区',time_blocks:'周时间块',custom_table:'自定义合并表格',chart:'坐标图底图',goal_grid:'目标进度格',radar:'生活维度雷达底图'};
export const advancedPresets={radial:{w:100,h:100},radial_habits:{w:110,h:110},habit_matrix:{w:120,h:70,rows:5,cols:31},year_pixels:{w:120,h:95},gantt:{w:120,h:85,rows:7,cols:14},quadrants:{w:120,h:100},kanban:{w:120,h:110,cols:3},rolling_week:{w:120,h:90,rows:10,cols:7},future_log:{w:120,h:120,rows:3,cols:2},time_blocks:{w:120,h:140,cols:7},custom_table:{w:120,h:80,rows:6,cols:4},chart:{w:110,h:85,rows:5,cols:7},goal_grid:{w:100,h:100,rows:10,cols:10},radar:{w:110,h:110,cols:6}};
const names=value=>String(value||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
const num=(v,label,min,max,integer=false)=>{v=Number(v);if(!Number.isFinite(v)||v<min||v>max||(integer&&!Number.isInteger(v)))throw new Error(`${label}需在${min}—${max}之间${integer?'且为整数':''}`);return v;};
export function tableMerges(value,rows,cols){
 const occupied=new Map(),merged=[];for(const raw of String(value||'').split(/\r?\n/).filter(s=>s.trim())){
  const parts=raw.split(/[,，]/).map(s=>Number(s.trim()));if(parts.length!==4||parts.some(v=>!Number.isInteger(v)||v<1))throw new Error('合并格式：起始行,起始列,跨行数,跨列数');const [r,c,rs,cs]=parts.map((v,i)=>i<2?v-1:v);if(r+rs>rows||c+cs>cols)throw new Error('合并区域超出表格');
  const id=merged.length;for(let a=r;a<r+rs;a++)for(let b=c;b<c+cs;b++){const key=a+','+b;if(occupied.has(key))throw new Error('合并区域不能重叠');occupied.set(key,id);}merged.push({r,c,rs,cs});
 }return {occupied,merged};
}
export function advancedElement(o,{line:lineMaker}){
 const type=o.type,x=num(o.x??12,'横向位置',0,420),y=num(o.y??45,'纵向位置',0,420),w=num(o.w,'宽',20,400),h=num(o.h,'高',20,400),stroke=num(o.stroke??.25,'线宽',.1,2),rows=num(o.rows??7,'行数',1,40,true),cols=num(o.cols??3,'列数',1,40,true),color=o.color??'#7d8980';if(!/^#[0-9a-f]{6}$/i.test(color))throw new Error('颜色无效');
 const layers=[],rowNames=names(o.rowLabels),colNames=names(o.colLabels),rings=num(o.rings??3,'圆环数',1,6,true),font=num(o.labelSize??2.4,'标签字号',1.5,6);
 const box=(a,b,c,d,fill='#ffffff00',label='')=>layers.push({...makeShapeLayer({x_mm:a,y_mm:b,w_mm:c,h_mm:d,fill}),design_role:'cell',design_label:label});
 const line=(a,b,c,d)=>{if(Math.hypot(c-a,d-b)>=.3)layers.push(...lineMaker(a,b,c,d,{color,stroke,dashed:!!o.dashed}));};
 const text=(s,a,b,size=font)=>layers.push({...makeTextLayer({text:String(s),x_mm:a,y_mm:b,size_mm:size,color}),design_label:String(s)});
 const label=(s,a,b,width,size=font)=>{const n=Math.max(1,Math.floor(width/(size*(/^[0-9:./%\-]+$/.test(String(s))?.55:1))));text([...String(s)].slice(0,n).join(''),a,b,size);};
 const frame=(a,b,c,d)=>{line(a,b,a+c,b);line(a,b+d,a+c,b+d);line(a,b,a,b+d);line(a+c,b,a+c,b+d);};
 const month=String(o.month||'2026-01'),year=Number(o.year??month.slice(0,4));
 const monthDays=()=>{if(!/^\d{4}-\d{2}$/.test(month)||Number(month.slice(5))<1||Number(month.slice(5))>12||Number(month.slice(0,4))<1900||Number(month.slice(0,4))>2199)throw new Error('月份需在1900—2199年之间');return new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate();};
 const matrix=(r,c,{left=22,header=10,rl=rowNames,cl=colNames}={})=>{
  if(w-left<10||h-header<10)throw new Error('请加大结构尺寸');const cw=(w-left)/c,rh=(h-header)/r;
  for(let a=0;a<r;a++){label(rl[a]||`项目${a+1}`,x,y+header+a*rh+1,left-2);for(let b=0;b<c;b++)box(x+left+b*cw,y+header+a*rh,cw,rh,'#ffffff00',`${a+1}行${b+1}列`);}
  for(let b=0;b<c;b++)label(cl[b]||b+1,x+left+b*cw+.4,y+1,cw-.5,Math.min(font,cw/1.5));
  for(let a=0;a<=r;a++)line(x+left,y+header+a*rh,x+w,y+header+a*rh);for(let b=0;b<=c;b++)line(x+left+b*cw,y+header,x+left+b*cw,y+h);
 };
 if(type==='radial'||type==='radial_habits'){
  const days=type==='radial_habits'?monthDays():0,cycle=num(o.cycleHours??24,'一圈小时',12,24,true),step=num(o.stepMinutes??60,'时间步长分钟',15,180,true),startHour=num(o.startHour??0,'起始小时',0,23.75),rotation=num(o.rotationOffset??0,'起始角度',-360,360);
  if(type==='radial'&&cycle*60%step!==0)throw new Error('时间步长需整除一圈时长');const count=days||cycle*60/step;if(count>96)throw new Error('圆盘分区过密');
  const cx=x+w/2,cy=y+h/2,R=Math.min(w,h)/2-9;if(R<12)throw new Error('圆盘宽高至少42mm');const nRings=type==='radial'?1:rings;
  for(let r=0;r<nRings;r++){const inner=R*(type==='radial'?.48:.22+(r/nRings)*.78),outer=type==='radial'?R:R*(.22+(r+1)/nRings*.78);
   for(let i=0;i<count;i++){const minute=(Math.round(startHour*60+i*step)%1440+1440)%1440,name=days?`${rowNames[r]||'习惯'+(r+1)} · ${i+1}日`:`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
    layers.push({...makeShapeLayer({shape:'sector',x_mm:cx-outer,y_mm:cy-outer,w_mm:2*outer,h_mm:2*outer,fill:'#ffffff00',stroke:color,stroke_mm:stroke}),start_deg:rotation+i*360/count,end_deg:rotation+(i+1)*360/count,inner_ratio:inner/outer,design_role:'cell',design_label:name});
   }
  }
  for(let i=0;i<count;i++){if(!days&&count>24&&i*step%60!==0)continue;const angle=(rotation+(i+.5)*360/count-90)*Math.PI/180,minute=(startHour*60+i*step)%1440,value=days?i+1:cycle===12?(Math.floor(minute/60)%12||12):String(Math.floor(minute/60)).padStart(2,'0');text(value,cx+Math.cos(angle)*(R+4)-String(value).length*font*.27,cy+Math.sin(angle)*(R+4)-font*.65,Math.min(font,2.6));}
  if(days)for(let r=0;r<rings;r++)label(rowNames[r]||'习惯'+(r+1),cx-5,cy-rings*1.5+r*3,10,2.1);else label(o.text||'我的一天',cx-R*.38,cy-1,R*.76,Math.min(font,3));
 }else if(type==='habit_matrix')matrix(rows,monthDays(),{cl:Array.from({length:monthDays()},(_,i)=>i+1)});
 else if(type==='gantt')matrix(rows,cols,{rl:rowNames.map(s=>s)||[],cl:colNames});
 else if(type==='year_pixels'){
  if(!Number.isInteger(year)||year<1900||year>2199)throw new Error('年份需在1900—2199之间');if(w<70||h<45)throw new Error('年度像素格建议至少70×45mm');const left=9,header=9,cw=(w-left)/31,rh=(h-header)/12;
  for(let d=1;d<=31;d++)text(d,x+left+(d-1)*cw,y,Math.min(font,2));
  for(let m=1;m<=12;m++){text(m+'月',x,y+header+(m-1)*rh,Math.min(font,2.4));const days=new Date(Date.UTC(year,m,0)).getUTCDate();for(let d=1;d<=31;d++){box(x+left+(d-1)*cw+.2,y+header+(m-1)*rh+.2,cw-.4,rh-.4,d<=days?'#ffffff00':'#e8e8e3',`${year}-${m}-${d}`);layers.at(-1).design_role=d<=days?'cell':'disabled-cell';}}
  for(let m=0;m<=12;m++)line(x+left,y+header+m*rh,x+w,y+header+m*rh);for(let d=0;d<=31;d++)line(x+left+d*cw,y+header,x+left+d*cw,y+h);
 }else if(type==='quadrants'){
  const titles=rowNames.length?rowNames:['重要且紧急','重要不紧急','紧急不重要','低优先级'];for(let r=0;r<2;r++)for(let c=0;c<2;c++){const xx=x+c*w/2,yy=y+r*h/2;frame(xx,yy,w/2,h/2);label(titles[r*2+c]||'',xx+2,yy+2,w/2-4);for(let dy=12;dy<h/2-3;dy+=7)line(xx+3,yy+dy,xx+w/2-3,yy+dy);}
 }else if(type==='kanban'){
  if(w/cols<12)throw new Error('看板每栏至少12mm');for(let c=0;c<cols;c++){const xx=x+c*w/cols;frame(xx,y,w/cols,h);label(colNames[c]||['待开始','进行中','已完成'][c]||'阶段'+(c+1),xx+2,y+2,w/cols-4);line(xx,y+10,xx+w/cols,y+10);}
 }else if(type==='rolling_week'){
  const count=num(cols,'状态列数',1,14,true),cw=Math.min(7,w*.45/count),labelX=x+count*cw+3,rh=(h-10)/rows;for(let c=0;c<count;c++)label(colNames[c]||['一','二','三','四','五','六','日'][c]||c+1,x+c*cw,y,cw-1);
  text('任务 / 状态',labelX,y);for(let r=0;r<rows;r++){for(let c=0;c<count;c++){box(x+c*cw,y+10+r*rh,cw,rh,'#ffffff00',`任务${r+1} · ${c+1}`);}label(rowNames[r]||'',labelX,y+11+r*rh,w-count*cw-4);line(x,y+10+(r+1)*rh,x+w,y+10+(r+1)*rh);}for(let c=0;c<=count;c++)line(x+c*cw,y+10,x+c*cw,y+h);
 }else if(type==='future_log'){
  if(rows*cols>12)throw new Error('未来计划分区最多12块');for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const xx=x+c*w/cols,yy=y+r*h/rows;frame(xx,yy,w/cols,h/rows);label(colNames[r*cols+c]||`${r*cols+c+1}月 / 阶段`,xx+2,yy+2,w/cols-4);for(let dy=11;dy<h/rows-2;dy+=7)line(xx+2,yy+dy,xx+w/cols-2,yy+dy);}
 }else if(type==='time_blocks'){
  const cycle=num(o.cycleHours??24,'时长小时',1,24),step=num(o.stepMinutes??60,'时间步长分钟',15,180),start=num(o.startHour??0,'起始小时',0,23.75);if(cycle*60%step)throw new Error('时间步长需整除时长');const n=cycle*60/step,left=13,header=9,cw=(w-left)/cols,rh=(h-header)/n;
  for(let c=0;c<cols;c++)label(colNames[c]||['周一','周二','周三','周四','周五','周六','周日'][c]||'第'+(c+1)+'栏',x+left+c*cw,y,cw-1);
  for(let r=0;r<n;r++){const minutes=Math.round(start*60+r*step)%1440;if(r*step%60===0)text(`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`,x,y+header+r*rh,Math.min(font,2.3));for(let c=0;c<cols;c++)box(x+left+c*cw,y+header+r*rh,cw,rh,'#ffffff00',`第${c+1}栏 ${minutes/60}时`);line(x+left,y+header+r*rh,x+w,y+header+r*rh);}line(x+left,y+h,x+w,y+h);for(let c=0;c<=cols;c++)line(x+left+c*cw,y+header,x+left+c*cw,y+h);
 }else if(type==='custom_table'){
  const {occupied,merged}=tableMerges(o.merges,rows,cols),cw=w/cols,rh=h/rows,cellId=(r,c)=>occupied.has(r+','+c)?'m'+occupied.get(r+','+c):`${r},${c}`;
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const merge=occupied.has(r+','+c)?merged[occupied.get(r+','+c)]:null;if(merge&&(merge.r!==r||merge.c!==c))continue;const rs=merge?.rs||1,cs=merge?.cs||1;box(x+c*cw,y+r*rh,cw*cs,rh*rs,'#ffffff00',`单元格 ${r+1},${c+1}`);if(r===0&&colNames[c])label(colNames[c],x+c*cw+1,y+r*rh+1,cw*cs-2);else if(c===0&&rowNames[r])label(rowNames[r],x+1,y+r*rh+1,cw*cs-2);}
  for(let r=0;r<=rows;r++){let start=null;for(let c=0;c<=cols;c++){const on=c<cols&&(r===0||r===rows||cellId(r-1,c)!==cellId(r,c));if(on&&start===null)start=c;if(!on&&start!==null){line(x+start*cw,y+r*rh,x+c*cw,y+r*rh);start=null;}}}
  for(let c=0;c<=cols;c++){let start=null;for(let r=0;r<=rows;r++){const on=r<rows&&(c===0||c===cols||cellId(r,c-1)!==cellId(r,c));if(on&&start===null)start=r;if(!on&&start!==null){line(x+c*cw,y+start*rh,x+c*cw,y+r*rh);start=null;}}}
 }else if(type==='chart'){
  const left=10,top=5,cw=(w-left)/cols,rh=(h-top-10)/rows;for(let r=0;r<=rows;r++){label(rowNames[r]||rows-r,x,y+top+r*rh-1,8);line(x+left,y+top+r*rh,x+w,y+top+r*rh);}for(let c=0;c<=cols;c++){line(x+left+c*cw,y+top,x+left+c*cw,y+h-10);label(colNames[c]||c,x+left+c*cw,y+h-7,Math.max(8,cw));}
 }else if(type==='goal_grid'){
  const cw=w/cols,rh=(h-8)/rows;if(cw<2||rh<2)throw new Error('进度格过密，请加大尺寸或减少行列');for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){box(x+c*cw+.5,y+r*rh+.5,cw-1,rh-1,'#ffffff00',`进度 ${r*cols+c+1}/${rows*cols}`);frame(x+c*cw+.5,y+r*rh+.5,cw-1,rh-1);}text(o.text||'目标：________',x,y+h-6);
 }else if(type==='radar'){
  const count=num(cols,'维度数',3,12,true),R=Math.min(w,h)/2-12,cx=x+w/2,cy=y+h/2,point=(i,r)=>[cx+Math.cos((i/count*360-90)*Math.PI/180)*r,cy+Math.sin((i/count*360-90)*Math.PI/180)*r];if(R<10)throw new Error('请加大雷达图尺寸');
  for(let r=1;r<=rings;r++)for(let i=0;i<count;i++)line(...point(i,R*r/rings),...point((i+1)%count,R*r/rings));for(let i=0;i<count;i++){line(cx,cy,...point(i,R));const p=point(i,R+6);label(colNames[i]||'维度'+(i+1),p[0]-5,p[1]-1,11,Math.min(font,2.4));}
 }
 if(layers.length>900)throw new Error('结构超过900个图层，请减少行列数或调大时间步长');const group=uid('G');return layers.map(l=>({...l,group_id:group,name:l.design_label||advancedTypes[type]}));
}
