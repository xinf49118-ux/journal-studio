import {pageDims,PAGE_SIZES,makeTextLayer,makeShapeLayer,lighten} from './core.js';
import {parseDate,monthCells} from './planner.js';
import {templates} from './templates.js';
export const bookSizes={A5:'A5 · 148 × 210 mm',A6:'A6 · 105 × 148 mm',B6:'B6（JIS）· 128 × 182 mm',Weeks:'Weeks 风格 · 94 × 188 mm'};
export const bookTypes={monthly:'月计划册',weekly:'周计划册',daily:'每日记录册'};
const DAY=86400000,iso=d=>new Date(d).toISOString().slice(0,10),short=d=>`${new Date(d).getUTCMonth()+1}/${new Date(d).getUTCDate()}`;
export function bookPlan(options={}){
 const o={mode:'year',year:new Date().getFullYear(),type:'weekly',size:'A5',theme:'garden',weekStart:1,front:true,notes:4,title:'我的手账',paper:'native',...options};
 if(!bookSizes[o.size]||!bookTypes[o.type]||!['year','range'].includes(o.mode)||!['native','a4'].includes(o.paper))throw new Error('请选择有效的成册选项');
 if(!templates.some(t=>t.id===o.theme))throw new Error('请选择有效的配色');
 if(![0,1].includes(Number(o.weekStart)))throw new Error('请选择每周开始日');o.weekStart=Number(o.weekStart);
 o.notes=Number(o.notes);if(!Number.isInteger(o.notes)||o.notes<0||o.notes>20)throw new Error('笔记附页须为0—20页');
 if(o.mode==='year'){
  if(!/^\d{4}$/.test(String(o.year)))throw new Error('年份须在1900—2199之间');
  o.start=`${o.year}-01-01`;o.end=`${o.year}-12-31`;
 }
 const start=+parseDate(o.start),end=+parseDate(o.end);
 if(end<start)throw new Error('结束日期不能早于开始日期');
 if((end-start)/DAY+1>366)throw new Error('一次最多生成366天，请分册导出');
 o.title=String(o.title||'我的手账').trim();if(!o.title)o.title='我的手账';
 if([...o.title].length>24)throw new Error('封面标题最多24个字');
 const pages=[],months=[],contents=[];
 for(let d=new Date(start);d<=new Date(end);d=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)))months.push(iso(d).slice(0,7));
 if(o.front)pages.push({kind:'cover',label:'封面'},{kind:'contents',label:'目录与打印说明'});
 let weeks=[];
 if(o.type==='weekly')for(let n=start-((new Date(start).getUTCDay()-o.weekStart+7)%7)*DAY;n<=end;n+=7*DAY)weeks.push(n);
 for(const month of months){
  contents.push({label:month,page:pages.length+1});pages.push({kind:'month',month,label:`${month} 月计划`});
  if(o.type==='daily')for(let n=start;n<=end;n+=DAY)if(iso(n).startsWith(month))pages.push({kind:'day',date:iso(n),label:iso(n)});
  if(o.type==='weekly')for(const n of weeks)if(iso(Math.max(n,start)).startsWith(month))pages.push({kind:'week',date:iso(n),label:`${iso(n)} 周计划`});
 }
 if(o.notes)contents.push({label:'自由笔记',page:pages.length+1});
 for(let i=0;i<o.notes;i++)pages.push({kind:'notes',label:`自由笔记 ${i+1}`});
 return {options:o,pages:pages.map((p,i)=>({...p,number:i+1})),contents};
}

export function bookPage(plan,index){
 const o=plan.options,p=plan.pages[index];if(!p)throw new Error('页码超出范围');
 const [w,h]=PAGE_SIZES[o.size],m=8,cw=w-2*m,t=templates.find(t=>t.id===o.theme),layers=[];
 const ink=t.ink,soft=lighten(ink,.24),stroke=lighten(ink,.68),wash=lighten(t.accent,.65);
 const box=(x,y,a,b,fill=wash)=>layers.push(makeShapeLayer({x_mm:x,y_mm:y,w_mm:a,h_mm:b,fill}));
 const text=(s,x,y,z=2.7,color=ink)=>layers.push(makeTextLayer({text:String(s),x_mm:x,y_mm:y,size_mm:z,color}));
 const line=(x,y,a,b=.15)=>box(x,y,a,b,stroke);
 const ruled=(x,y,a,b,gap=7)=>{for(let yy=y;yy<=b;yy+=gap)line(x,yy,a);};
 const wrap=(s,x,y,width,z=4)=>{let chars=[...s],len=Math.max(1,Math.floor(width/z));for(let i=0;i<chars.length;i+=len)text(chars.slice(i,i+len).join(''),x,y+(i/len)*z*1.6,z);};
 const inside=date=>date>=o.start&&date<=o.end;
 text(`手账工坊 / ${bookTypes[o.type]}`,m,7,2.3,soft);
 text(`${p.number} / ${plan.pages.length}`,w-26,h-8,2.3,soft);
 const title=p.kind==='month'?p.month:p.kind==='day'?p.date:p.kind==='week'?'这一周':p.kind==='notes'?'自由笔记':p.kind==='contents'?'目录与使用':'给日子留一页';
 text(title,m,16,Math.min(4.6,cw/16));line(m,26,Math.min(28,cw));
 if(p.kind==='cover'){
  box(m,40,cw,h-87);wrap(o.title,m+5,51,cw-10,Math.min(5,cw/13));
  text(o.start,m+5,h-78,3);text('— '+o.end,m+5,h-69,3);
  text('属于：________________',m,h-35,2.7);text('慢慢写，认真过。',m,h-23,2.7,soft);
 }else if(p.kind==='contents'){
  const gap=Math.min(6,(h-73)/Math.max(plan.contents.length,1));
  plan.contents.forEach((r,i)=>{text(r.label,m,33+i*gap,2.7);text(String(r.page),w-18,33+i*gap,2.7);});
  text('按页码顺序 · 单面打印',m,h-37,2.5);text('实际尺寸100% · 先试印一页',m,h-29,2.5);
  text('周页浅色日期属于所选时段外',m,h-21,2.3,soft);
 }else if(p.kind==='month'){
  const y=44,cell=cw/7,rh=(h-85)/6,days=['日','一','二','三','四','五','六'];
  text('本月重点：',m,31,2.7);line(m+18,36,cw-18);
  for(let c=0;c<7;c++)text(days[(c+o.weekStart)%7],m+c*cell+2,39,2.5);
  for(let c=0;c<=7;c++)line(m+c*cell,y,.15,rh*6);
  for(let r=0;r<=6;r++)line(m,y+r*rh,cw);
  monthCells(p.month,o.weekStart).forEach((d,i)=>{if(d)text(d,m+i%7*cell+1.5,y+Math.floor(i/7)*rh+1.5,2.4,inside(p.month+'-'+String(d).padStart(2,'0'))?ink:lighten(ink,.65));});
  text('本月回顾：',m,h-34,2.7);ruled(m,h-24,cw,h-16);
 }else if(p.kind==='week'){
  const start=+new Date(p.date+'T00:00:00Z'),rh=(h-64)/7,days=['周日','周一','周二','周三','周四','周五','周六'];
  text(`${iso(start)} —`,m,31,2.7);text(iso(start+6*DAY),m+35,31,2.7);
  for(let i=0;i<7;i++){const d=start+i*DAY,y=42+i*rh,col=inside(iso(d))?ink:lighten(ink,.65);
   box(m,y,22,rh-1,inside(iso(d))?wash:'#f5f5f3');text(days[new Date(d).getUTCDay()],m+2,y+2,2.5,col);text(short(d),m+2,y+7,2.5,col);
   line(m+25,y+rh-2,cw-25);if(rh>15)line(m+25,y+rh/2,cw-25);
  }
  text('这一周想记住：',m,h-18,2.5);
 }else if(p.kind==='day'){
  const days=['周日','周一','周二','周三','周四','周五','周六'];text(days[new Date(p.date+'T00:00:00Z').getUTCDay()]+'  心情：______',m,31,2.7);
  text('今天的重点',m,42,2.8);ruled(m,53,cw,66,7);
  text('时间与记录',m,76,2.8);
  const rows=Math.max(4,Math.floor((h-105)/8));for(let i=0;i<rows;i++){const y=87+i*8;text('____',m,y-3,2.3,soft);line(m+15,y,cw-15);}
  text('感谢今天：',m,h-19,2.5);line(m+19,h-14,cw-19);
 }else ruled(m,37,cw,h-18,7);
 return {version:1,page:{size:o.size,orientation:'portrait',dpi:300,bleed_mm:0,crop_marks:false},background:{type:'color',value:'#FFFFFF',tile:false},layers};
}

export function bookPrintPage(project,paper='native'){
 if(paper==='native')return structuredClone(project);
 if(paper!=='a4')throw new Error('打印纸张无效');
 const [w,h]=pageDims(project.page);if(w>190||h>250)throw new Error('此尺寸超过A4裁切版可用区域，请改用原尺寸导出');const x=(210-w)/2,y=(297-h)/2,p=structuredClone(project);
 p.page.size='A4';for(const l of p.layers){l.x_mm+=x;l.y_mm+=y;}
 const line=(a,b,c,d=.18)=>p.layers.push(makeShapeLayer({x_mm:a,y_mm:b,w_mm:c,h_mm:d,fill:'#8a8a82'}));
 for(const [a,b] of [[x,y],[x+w,y],[x,y+h],[x+w,y+h]]){
  line(a===x?a-5:a+1,b,4);line(a,b===y?b-5:b+1,.18,4);
 }
 p.layers.push(makeTextLayer({text:`${w} × ${h} mm · A4单面 · 实际尺寸100%`,x_mm:12,y_mm:274,size_mm:3,color:'#555555'}));
 p.layers.push(makeTextLayer({text:'核对50mm标尺，再沿角标裁切',x_mm:12,y_mm:283,size_mm:2.8,color:'#555555'}));
 line(135,289,50);line(135,287,.18,2);line(185,287,.18,2);return p;
}
