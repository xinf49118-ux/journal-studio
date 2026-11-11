import {makeMaterialLayer, makeShapeLayer, makeTextLayer, lighten} from './core.js';
import {templates} from './templates.js';
import {extraLayouts} from './planner-catalog.js';
import {expandedPlannerProject} from './planner-extra.js';
import {storyLayouts} from './brand-catalog.js';
import {chinaLayouts} from './china-catalog.js';

export const plannerLayouts = [
 {id:'monthly',name:'月计划',group:'日程安排',period:'month',subtitle:'看见整个月，为重要的日子留白'},
 {id:'weekly',name:'周计划',group:'日程安排',period:'week',subtitle:'每天一点进展，也给自己留些余地'},
 {id:'daily',name:'每日记录',group:'日程安排',period:'day',subtitle:'安排时间，收藏今天的心情与片刻'},
 {id:'habits',name:'习惯打卡',group:'日程安排',period:'month',subtitle:'把小小坚持，慢慢变成日常'},
 ...extraLayouts,
 ...storyLayouts,
 ...chinaLayouts,
];
const DAY = 86400000;
export function todayString(date=new Date()) {
 return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function parseDate(value) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('请选择有效日期');
 const [y,m,d]=value.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));
 if(y<1900||y>2199||date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)throw new Error('日期需在 1900—2199 年之间');
 return date;
}
export function monthCells(month,weekStart=1) {
 const first=parseDate(`${month}-01`),count=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
 const offset=(first.getUTCDay()-weekStart+7)%7;
 return Array.from({length:42},(_,i)=>i>=offset&&i<offset+count?i-offset+1:null);
}
export function weekDates(date,weekStart=1) {
 const day=parseDate(date),offset=(day.getUTCDay()-weekStart+7)%7;
 return Array.from({length:7},(_,i)=>new Date(day.getTime()+(i-offset)*DAY));
}
export function plannerProject(options={},materials=[]) {
 const t=templates.find(t=>t.id===options.theme)||templates[0];
 const layout=plannerLayouts.find(l=>l.id===options.layout)||plannerLayouts[0];
 if([...extraLayouts,...storyLayouts,...chinaLayouts].some(l=>l.id===layout.id))return expandedPlannerProject(options,materials,t,layout,{parseDate,monthCells,weekDates,todayString});
 const undated=!!options.undated,weekStart=Number(options.weekStart)===0?0:1;
 const date=undated?'2026-01-01':(options.date??todayString());
 const month=undated?'2026-01':(options.month??date.slice(0,7));
 const focus=layout.id==='daily'||layout.id==='weekly'?parseDate(date):parseDate(`${month}-01`);
 const days=['周日','周一','周二','周三','周四','周五','周六'];
 const labels=Array.from({length:7},(_,i)=>days[(i+weekStart)%7]);
 const layers=[],lineColor=lighten(t.ink,.77),muted=lighten(t.ink,.26),wash=lighten(t.accent,.68);
 const box=(x,y,w,h,fill=wash)=>layers.push(makeShapeLayer({x_mm:x,y_mm:y,w_mm:w,h_mm:h,fill}));
 const text=(s,x,y,size=3,color=t.ink)=>layers.push(makeTextLayer({text:s,x_mm:x,y_mm:y,size_mm:size,color}));
 const line=(x,y,w,h=.18)=>box(x,y,w,h,lineColor);
 const rule=(x,y,w,n=3,step=7)=>{for(let i=0;i<n;i++)line(x,y+i*step,w);};
 const check=(x,y,size=2.3)=>{box(x,y,size,size,lineColor);box(x+.25,y+.25,size-.5,size-.5,'#FFFFFF');};
 const section=(s,x,y,w)=>{text(s,x,y,2.8);line(x,y+6,w);};
 const pad=n=>String(n).padStart(2,'0');
 const monthTitle=undated?'我的月计划':`${focus.getUTCFullYear()} / ${pad(focus.getUTCMonth()+1)}`;
 text(`${t.name}  /  ${layout.name}`,12,11,2.5,muted);
 let title=layout.id==='monthly'?monthTitle:layout.id==='habits'?(undated?'习惯，慢慢养成':`${pad(focus.getUTCMonth()+1)} 月 · 习惯打卡`):layout.id==='daily'?(undated?'今天，值得记录':`${focus.getUTCFullYear()}.${pad(focus.getUTCMonth()+1)}.${pad(focus.getUTCDate())}`):'这一周，慢慢来';
 text(title,12,21,6.2);box(12,33,28,.8,t.accent);
 const motif=materials.find(m=>m.id===`sticker_collection_${t.id}_00`);
 if(motif)layers.push(makeMaterialLayer(motif,{x_mm:117,y_mm:10,w_mm:19,h_mm:19}));
 if(layout.id==='monthly') {
  text(undated?'月份：________    本月想完成：':'本月想完成：',12,39,2.8);line(67,44,69);
  const x=12,y=59,cw=124/7,rh=17.5;
  labels.forEach((s,i)=>{box(x+i*cw,50,cw,7,i===((7-weekStart)%7)||i===((6-weekStart+7)%7)?wash:'#F7F7F4');text(s,x+i*cw+5.3,51.4,2.6);});
  for(let r=0;r<=6;r++)line(x,y+r*rh,124);
  for(let c=0;c<=7;c++)line(x+c*cw,y,.18,rh*6);
  (undated?Array(42).fill(null):monthCells(month,weekStart)).forEach((d,i)=>{if(d)text(String(d),x+(i%7)*cw+1.7,y+Math.floor(i/7)*rh+1.5,2.6);});
  section('值得期待',12,172,57);section('本月的小收获',79,172,57);rule(12,187,57,2,8);rule(79,187,57,2,8);
 } else if(layout.id==='weekly') {
  const dates=weekDates(date,weekStart),short=d=>`${d.getUTCMonth()+1}/${d.getUTCDate()}`;
  text(undated?'日期：________  —  ________':`${short(dates[0])} — ${short(dates[6])}  ·  ${dates[0].getUTCFullYear()}`,12,39,3,muted);
  const y=51,rh=18.5;
  for(let i=0;i<7;i++){
   box(12,y+i*rh,18,rh-.8,wash);text(labels[i],15,y+i*rh+2.5,3);
   if(!undated)text(short(dates[i]),15,y+i*rh+9,2.5,muted);
   line(32,y+i*rh+rh-.8,62);check(34,y+i*rh+4);rule(40,y+i*rh+7,51,2,7);
  }
  section('本周重点',103,51,33);for(let i=0;i<3;i++){check(103,64+i*11);line(109,67+i*11,27);}
  section('留给自己',103,105,33);rule(103,120,33,6,9);
  section('一周回顾',12,187,124);line(12,201,124);
 } else if(layout.id==='daily') {
  text(undated?'日期：________    星期：____':days[focus.getUTCDay()],12,39,2.8,muted);
  text('天气：______   心情：______',64,39,2.8,muted);
  section('时间安排',12,51,43);section('今天的三件事',64,51,72);
  for(let i=0;i<16;i++){const y=63+i*7.9;text(pad(7+i)+':00',12,y,2.3,muted);line(23,y+4.5,32);}
  for(let i=0;i<3;i++){check(64,63+i*10);line(70,67+i*10,66);}
  box(64,99,72,41,wash);text('贴一张照片，或画下今天',69,116,3,muted);
  section('今天的小故事',64,148,72);rule(64,163,72,4,8);
  text('今天感谢：',12,195,2.8);line(31,200,105);
 } else {
  text(undated?'月份：________  ·  每完成一天，涂满一个小格':'每天一小格，记录自己的节奏',12,39,2.8,muted);
  const count=undated?31:new Date(Date.UTC(focus.getUTCFullYear(),focus.getUTCMonth()+1,0)).getUTCDate();
  const names=['早点休息','喝够水','动一动','读几页书','记录心情','我的小习惯'];
  const cw=5.5,x=48;
  for(let half=0;half<2;half++){
   const y=54+half*67;
   text(half?'下半月':'上半月',12,y,3);box(x,y,88,7,wash);
   for(let c=0;c<16;c++){
    const d=half*16+c+1;
    if(d<=count)text(String(d),x+c*cw+1.3,y+1.5,2.3);
    else box(x+c*cw,y,cw,55,'#F0EFEC');
   }
   for(let r=0;r<6;r++)text(names[r],12,y+9+r*8,2.8);
   for(let r=0;r<=6;r++)line(x,y+7+r*8,88);
   for(let c=0;c<=16;c++)line(x+c*cw,y+7,.18,48);
  }
  text('这个月，想对自己说：',12,187,3);line(12,199,124);
 }
 return {version:1,page:{size:'A5',orientation:'portrait',dpi:300,bleed_mm:0,crop_marks:false},background:{type:'color',value:'#FFFFFF',tile:false},layers};
}
