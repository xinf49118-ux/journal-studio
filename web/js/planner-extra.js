import {makeMaterialLayer,makeShapeLayer,makeTextLayer,lighten} from './core.js';

export function expandedPlannerProject(o,materials,t,layout,dates) {
 const {parseDate,monthCells,weekDates,todayString}=dates;
 const undated=!!o.undated,start=Number(o.weekStart)===0?0:1,now=todayString();
 const date=undated?'2026-01-01':(o.date??now),month=undated?'2026-01':(o.month??now.slice(0,7));
 let focus=new Date(Date.UTC(2026,0,1));
 if(!undated){
  if(['day','week'].includes(layout.period))focus=parseDate(date);
  if(layout.period==='month')focus=parseDate(month+'-01');
  if(layout.period==='year')focus=parseDate(String(o.year??now.slice(0,4))+'-01-01');
 }
 const year=focus.getUTCFullYear(),monthN=focus.getUTCMonth()+1;
 const monthKey=`${year}-${String(monthN).padStart(2,'0')}`;
 const count=undated?31:new Date(Date.UTC(year,monthN,0)).getUTCDate();
 const days=['周日','周一','周二','周三','周四','周五','周六'],labels=Array.from({length:7},(_,i)=>days[(i+start)%7]);
 const layers=[],ink=t.ink,soft=lighten(ink,.23),stroke=lighten(ink,.72),wash=lighten(t.accent,.68);
 const box=(x,y,w,h,fill=wash)=>layers.push(makeShapeLayer({x_mm:x,y_mm:y,w_mm:w,h_mm:h,fill}));
 const text=(s,x,y,size=2.8,color=ink)=>layers.push(makeTextLayer({text:String(s),x_mm:x,y_mm:y,size_mm:size,color}));
 const line=(x,y,w,h=.16)=>box(x,y,w,h,stroke);
 const rule=(x,y,w,n=3,gap=7)=>{for(let i=0;i<n;i++)line(x,y+i*gap,w);};
 const checkbox=(x,y,s=2)=>{box(x,y,s,s,stroke);box(x+.23,y+.23,s-.46,s-.46,'#FFFFFF');};
 const section=(s,x,y,w)=>{text(s,x,y);line(x,y+6,w);};
 const grid=(x,y,w,h,step=4)=>{for(let dx=0;dx<=w+.01;dx+=step)line(x+dx,y,.12,h);for(let dy=0;dy<=h+.01;dy+=step)line(x,y+dy,w,.12);};
 const table=(headers,widths,{x=12,y=51,rows=12,rh=10,hh=8,prefill=[]}={})=>{
  const total=widths.reduce((a,b)=>a+b,0);box(x,y,total,hh);
  let xx=x;headers.forEach((s,i)=>{text(s,xx+2,y+2,2.6);xx+=widths[i];});
  for(let r=0;r<=rows;r++)line(x,y+hh+r*rh,total);
  let edge=x;for(const width of [0,...widths]){edge+=width;line(edge,y,.16,hh+rows*rh);}
  prefill.forEach((row,r)=>{let xx=x;row.forEach((value,c)=>{if(value)text(value,xx+2,y+hh+r*rh+2,2.6);xx+=widths[c];});});
 };
 const miniCalendar=(key,x,y,w,h,blank=undated)=>{
  const cw=w/7,rh=(h-14)/6;
  box(x,y,w,7);text(blank?'月份：____':`${Number(key.slice(5))} 月`,x+2,y+1.5,2.6);
  labels.forEach((s,c)=>text(s.slice(1),x+c*cw+1.2,y+8,2.2));
  const cells=blank?Array(42).fill(null):monthCells(key,start);
  cells.forEach((d,i)=>{if(d)text(d,x+(i%7)*cw+1,y+14+Math.floor(i/7)*rh,2.2);});
 };
 const week=()=>weekDates(date,start);
 const short=d=>`${d.getUTCMonth()+1}/${d.getUTCDate()}`;
 text(`${t.name}  /  ${layout.group}`,12,11,2.5,soft);text(layout.name,12,21,6);box(12,33,28,.8,t.accent);
 const art=materials.find(m=>m.id===`sticker_collection_${t.id}_00`);
 if(art)layers.push(makeMaterialLayer(art,{x_mm:117,y_mm:10,w_mm:19,h_mm:19}));
 let dateLabel=layout.period==='year'?(undated?'年份：________':`${year} 年`):layout.period==='month'?(undated?'月份：________':`${year} 年 ${monthN} 月`):layout.period==='day'?(undated?'日期：________':`${date}  ${days[focus.getUTCDay()]}`):layout.period==='week'?(undated?'本周日期：________':`${week()[0].toISOString().slice(0,10)} — ${week()[6].toISOString().slice(0,10)}`):'按自己的节奏，慢慢记录';
 if(['study_2weeks','fortnight_diary'].includes(layout.id)&&!undated)dateLabel=`${week()[0].toISOString().slice(0,10)} — ${new Date(week()[0].getTime()+13*86400000).toISOString().slice(0,10)}`;
 text(dateLabel,12,39,2.7,soft);
 const id=layout.id;
 if(id==='age_lookup') {
  text('当年生日后满周岁；生日未到时减1岁',12,51,2.5,soft);
  for(let c=0;c<4;c++){
   const x=12+c*31;box(x,60,29,7);text('出生年 / 周岁',x+1,61.5,2.5);
   for(let r=0;r<25;r++){const age=c*25+r,y=70+r*5.2;text(`${undated?'____':year-age} / ${String(age).padStart(2,'0')}`,x+2,y,2.5);line(x,y+4.3,29);}
  }
 } else if(id==='body_track') {
  text('自填指标与刻度，再按每天的记录描点连线',12,51,2.5,soft);
  for(let i=0;i<2;i++){
   const y=63+i*67;section(`指标${i+1}：________  单位：____`,12,y,124);
   text('上限____',12,y+14,2.2);text('下限____',12,y+53,2.2);
   for(let r=0;r<=5;r++)line(34,y+13+r*8,102);
   for(let d=0;d<=count;d++)line(34+d*102/count,y+13,.12,40);
   for(let d=1;d<=count;d++)text(d,34+(d-.7)*102/count,y+55,1.8);
  }
  text('备注：____________________________',12,197,2.6);
 } else if(id==='same_day_months') {
  const day=focus.getUTCDate();
  for(let m=0;m<12;m++){
   const x=12+(m%2)*65,y=51+Math.floor(m/2)*25;
   const valid=undated||new Date(Date.UTC(year,m+1,0)).getUTCDate()>=day;
   box(x,y,59,6);text(undated?`${m+1} 月 / ____ 日`:`${m+1} 月 ${day} 日`,x+2,y+1,2.6);
   if(!valid)text('本月无此日',x+30,y+1,2.5,soft);
   rule(x,y+14,59,2,7);
  }
 } else if(id==='challenge21') {
  if(!undated&&new Date(focus.getTime()+20*86400000).getUTCFullYear()>2199)throw new Error('21天计划的结束日期不能超过2199年');
  text('行动目标：____________________________',12,51,2.8);
  table(['日期','今天的行动 / 感受','完成'],[24,88,12],{y:61,rows:21,rh:6.2,prefill:Array.from({length:21},(_,i)=>[undated?`第${i+1}天`:short(new Date(focus.getTime()+i*86400000))])});
  for(let i=0;i<21;i++)checkbox(128,71+i*6.2,2);
 } else if(id==='cornell') {
  box(12,51,124,8);text('主题：____________________________',15,53,2.8);
  text('关键词 / 问题',12,65,2.8);text('笔记 / 例子 / 推导',49,65,2.8);line(43,65,.2,104);
  rule(12,79,25,12,8);rule(49,79,87,12,8);
  section('用自己的话总结',12,178,124);rule(12,193,124,2,7);
 } else if(id==='film_review') {
  section('片名 / 导演 / 观看地点',12,51,124);line(12,68,124);
  box(12,78,55,44);text('电影票根 / 自己的速写',15,96,2.5,soft);
  section('人物与印象',77,78,59);rule(77,94,59,4,8);
  section('记住的片段 / 想说的话',12,136,124);rule(12,152,124,6,8);
 } else if(id==='sleep_log') {
  text('涂色标记睡眠 · 每行从当天18点至次日17点',12,51,2.5,soft);
  for(let h=0;h<24;h++)text(String((h+18)%24).padStart(2,'0'),25+h*4.6,59,2);
  for(let d=0;d<count;d++)text(d+1,13,66+d*4,2.3);
  for(let d=0;d<=count;d++)line(24,65+d*4,110.4);
  for(let h=0;h<=24;h++)line(24+h*4.6,65,.12,count*4);
  text('备注：',12,196,2.6);line(27,200,109);
 } else if(id==='fortnight_diary') {
  for(let i=0;i<14;i++){
   const x=12+Math.floor(i/7)*65,y=51+(i%7)*21;
   const d=new Date(week()[0].getTime()+i*86400000);
   box(x,y,59,6);text(undated?`第 ${i+1} 天`:`${short(d)}  ${days[d.getUTCDay()]}`,x+2,y+1,2.7);rule(x,y+13,59,2,7);
  }
 } else if(id==='weekly_dual') {
  text('日程 A',39,51,3);text('日程 B',94,51,3);
  for(let i=0;i<7;i++){
   const y=63+i*19;box(12,y,18,17);text(labels[i],14,y+2,2.5);if(!undated)text(short(week()[i]),14,y+9,2.4);
   rule(34,y+7,47,2,8);rule(89,y+7,47,2,8);
  }
 } else if(id==='dual_month') {
  for(let i=0;i<2;i++){
   const x=12+i*65;section(i?'日程 B':'日程 A',x,51,59);miniCalendar(monthKey,x,61,59,93);
   for(let r=0;r<=6;r++)line(x,75+r*(79/6),59);
   for(let c=0;c<=7;c++)line(x+c*59/7,75,.12,79);
   section('本月重点',x,164,59);rule(x,180,59,3,9);
  }
 } else if(id==='three_year'||id==='ten_year') {
  const n=id==='three_year'?3:10,rh=n===3?49:14.7;
  if(!undated&&year+n-1>2199)throw new Error(`起始年份不能晚于 ${2200-n} 年`);
  for(let i=0;i<n;i++){
   const y=51+i*rh,yr=year+i;
   const leap=undated||focus.getUTCMonth()!==1||focus.getUTCDate()!==29||new Date(Date.UTC(yr,1,29)).getUTCMonth()===1;
   text(undated?`第 ${i+1} 年：____`:`${yr} 年`,12,y,2.8);
   if(!leap)text('本年无2月29日',49,y,2.6,soft);
   if(n===3)rule(12,y+16,124,4,8);else line(49,y+10,87);
  }
 } else if(id==='eight_blocks') {
  for(let i=0;i<8;i++){
   const x=12+i%2*65,y=51+Math.floor(i/2)*38;
   section(i<7?['周一','周二','周三','周四','周五','周六','周日'][i]:'自由随记',x,y,59);rule(x,y+16,59,3,8);
  }
 } else if(id==='monthly_dimensions') {
  table(['维度','本月目标 / 行动','月底回看'],[20,64,40],{rows:7,rh:18,prefill:['学业','专注','社团','运动','饮食','睡眠','花销'].map(s=>[s])});
  text('可以改成适合自己的七个方面',12,196,2.7,soft);
 } else if(id==='wellbeing_day') {
  section('今天的24小时',12,51,57);
  for(let h=0;h<24;h++){text(String(h).padStart(2,'0')+':00',12,63+h*5.5,2.4);line(24,67+h*5.5,45);}
  ['早餐 / 午餐 / 晚餐','饮水 / 运动','昨夜睡眠 / 起床状态','今天的感受 / 明日调整'].forEach((s,i)=>{const y=51+i*37;section(s,79,y,57);rule(79,y+16,57,3,8);});
 } else if(id==='semester_review') {
  ['学业与知识','新学会的技能','关系与合作','习惯与身体','值得记住的经历','下学期要改变的事'].forEach((s,i)=>{const x=12+i%2*65,y=51+Math.floor(i/2)*43;section(s,x,y,59);rule(x,y+16,59,3,9);});
  section('下一步 / 开始日期',12,184,124);line(12,200,124);
 } else if(id==='meeting_notes') {
  section('会议 / 参与人 / 议题',12,51,124);line(12,68,124);
  section('讨论与结论',12,79,124);rule(12,95,124,5,8);
  table(['后续行动','负责人','完成期限'],[72,26,26],{y:143,rows:4,rh:12});
 } else if(id==='todo_priority') {
  section('今天最重要的三件事',12,51,124);
  for(let i=0;i<3;i++){checkbox(12,67+i*11);line(20,72+i*11,116);}
  table(['','其他待办','期限 / 备注'],[8,78,38],{y:106,rows:8,rh:10});
  for(let i=0;i<8;i++)checkbox(15,118+i*10);
 } else if(id==='goal_steps') {
  section('我想实现的一个愿望',12,51,124);line(12,68,124);
  section('为什么值得做 / 怎样算完成',12,78,124);rule(12,94,124,2,8);
  table(['行动步骤','完成期限','检查结果'],[72,26,26],{y:113,rows:3,rh:16,prefill:[['01'],['02'],['03']]});
  section('今天就能开始的一小步',12,180,124);line(12,199,124);
 } else if(id==='weekly_review') {
  const titles=['本周真正推进的事','卡在哪里 / 可以求助谁','时间花在哪里','有效的方法 / 下周继续'];
  titles.forEach((s,i)=>{const x=12+i%2*65,y=51+Math.floor(i/2)*52;section(s,x,y,59);rule(x,y+17,59,4,8);});
  section('下周最重要的三件事',12,159,124);for(let i=0;i<3;i++){checkbox(12,175+i*11);line(20,179+i*11,116);}
 } else if(id==='reading_extract') {
  section('书名 / 作者 / 页码',12,51,124);line(12,68,124);
  section('原文摘录',12,79,124);rule(12,95,124,5,8);
  section('我的理解 / 联想到的事',12,143,124);rule(12,159,124,6,8);
 } else if(id==='plant_observation') {
  section('名称 / 观察地点 / 天气',12,51,124);line(12,67,124);
  box(12,77,67,68);text('照片 / 手绘 / 叶片拓印',17,108,2.8,soft);
  ['叶片与形态','花果与气味','生长环境'].forEach((s,i)=>{section(s,89,77+i*24,47);line(89,94+i*24,47);});
  section('今天发现的变化 / 下次想观察',12,159,124);rule(12,176,124,4,8);
 } else if(id==='season_notes') {
  ['春 · 萌发','夏 · 生长','秋 · 收获','冬 · 收藏'].forEach((s,i)=>{const x=12+i%2*65,y=51+Math.floor(i/2)*68;box(x,y,59,8);text(s,x+3,y+2,3);text('日期 / 地点 / 看到的变化',x,y+14,2.5,soft);rule(x,y+28,59,4,9);});
  section('这一年，最想留下的自然记忆',12,191,124);
 } else if(id==='museum_notes') {
  section('展览 / 场馆 / 作品名称',12,51,124);line(12,68,124);
  box(12,78,60,65);text('作品速写 / 票根 / 照片',16,107,2.6,soft);
  ['作者 / 年代','材质 / 展签信息','吸引我的细节'].forEach((s,i)=>{section(s,82,78+i*24,54);line(82,94+i*24,54);});
  section('我的感受 / 想继续了解的问题',12,158,124);rule(12,175,124,4,8);
 } else if(id==='scene_collage') {
  box(12,51,124,89,'#F7F1E7');line(12,140,124);
  for(const [key,x,y,w,h] of [['arch_window',20,57,46,58],['desk',73,93,57,41],['lamp',105,82,27,31]]){
   const m=materials.find(m=>m.id===`sticker_cn_scene_${key}`);if(m)layers.push(makeMaterialLayer(m,{x_mm:x,y_mm:y,w_mm:w,h_mm:h}));
  }
  section('窗边的一段时光',12,153,124);rule(12,170,124,4,9);
 } else if(id==='letter_page') {
  text('亲爱的：________________',12,53,3.5);rule(12,76,124,12,8);
  text('此刻的我：____________',72,184,2.9);text('希望在这一天打开：____________',54,198,2.7,soft);
 } else if(id==='daily_story') {
  section('今天的关键词',12,51,124);line(12,67,124);
  box(12,77,55,53);text('贴一张照片 / 画一幅画',16,99,2.8,soft);
  section('今天的片刻',77,77,59);rule(77,93,59,5,8);
  section('想写下的故事',12,143,124);rule(12,159,124,6,8);
 } else if(id==='week_scrap') {
  for(let i=0;i<7;i++){const y=51+i*19;box(12,y,51,6);text(labels[i]+(undated?'':' '+short(week()[i])),14,y+1,2.7);line(12,y+15,51);}
  text('这一周，想留下',73,51,3);grid(73,63,63,119,5);text('照片 / 票根 / 画画 / 随手写',74,188,2.7,soft);
 } else if(id==='five_year') {
  if(!undated&&year>2195)throw new Error('五年记录的起始年份需不晚于2195年');
  for(let i=0;i<5;i++){
   const y=51+i*29,yy=year+i;box(12,y,124,6);
   const leap=monthN===2&&focus.getUTCDate()===29&&new Date(Date.UTC(yy,2,0)).getUTCDate()!==29;
   text(undated?`第 ${i+1} 年：________`:`${yy} 年${leap?' · 本年无2月29日，可留空':''}`,14,y+1,2.8);
   rule(12,y+15,124,2,8);
  }
 } else if(id==='life_left') {
  text('今日行程',12,51,3);text('今日重点 / 待办',73,51,3);
  for(let i=0;i<24;i++){const y=62+i*5.7;text(`${String(i).padStart(2,'0')}:00`,12,y,2.4,soft);line(25,y+4,38);}
  for(let i=0;i<5;i++){checkbox(73,64+i*13);line(80,68+i*13,56);}
  section('三餐与休息',73,135,63);rule(73,152,63,4,9);text('回忆写在配套页 →',73,195,2.7,soft);
 } else if(id==='life_right') {
  box(12,51,124,56);text('贴上今天的画面',49,76,3,soft);
  section('心情 / 天气',12,118,124);line(12,134,124);
  section('今天的故事与感受',12,144,124);rule(12,160,124,5,9);
 } else if(id==='gratitude') {
  ['让我开心的一件小事','想感谢的人或事','今天也做得不错的地方'].forEach((s,i)=>{const y=51+i*40;box(12,y,8,8);text(String(i+1),14.5,y+1.5,3);section(s,26,y,110);rule(26,y+17,110,2,9);});
  section('留给明天的一句话',12,179,124);line(12,198,124);
 } else if(id==='photo_story') {
  [[12,51,58,62],[78,51,58,62],[12,125,58,62]].forEach(([x,y,w,h],i)=>{box(x,y,w,h);box(x+3,y+3,w-6,h-14,'#FFFFFF');text(`画面 ${i+1}`,x+18,y+h-8,2.7);});
  section('这一天的故事',78,125,58);rule(78,143,58,6,8);text('人物 / 地点：',12,196,2.7);line(38,201,98);
 } else if(id==='trip_plan') {
  section('目的地 / 日期 / 同行的人',12,51,124);line(12,68,124);
  table(['日期','路线 / 交通','住宿 / 预约'],[23,51,50],{y:77,rows:4,rh:11});
  section('装进行李',12,141,58);section('出发前确认',78,141,58);
  for(let i=0;i<4;i++)for(const x of [12,78]){checkbox(x,157+i*12);line(x+7,161+i*12,51);}
 } else if(id==='trip_log') {
  section('今天走过的路线',12,51,124);line(12,68,124);
  box(12,78,70,65);text('风景 / 照片 / 手绘地图',18,106,2.8,soft);
  section('旅途花费',92,78,44);rule(92,96,44,5,9);
  section('遇见的人、吃过的味道与意外惊喜',12,156,124);rule(12,173,124,4,8);
 } else if(id==='tickets') {
  for(let i=0;i<3;i++){const y=51+i*49;box(12,y,76,39);box(13,y+1,74,37,'#FFFFFF');text(`票根 ${i+1}`,41,y+16,3,soft);section('日期 / 地点',98,y,38);rule(98,y+16,38,3,8);}
 } else if(id==='stamp_walk') {
  for(let i=0;i<6;i++){const x=12+i%2*65,y=51+Math.floor(i/2)*49;box(x,y,59,33);box(x+1,y+1,57,31,'#FFFFFF');text(`集章 ${i+1}`,x+20,y+14,3,soft);text('地点 / 日期：',x,y+36,2.5);line(x+23,y+42,36);}
 } else if(id==='cafe_visit') {
  section('店名 / 日期 / 地址',12,51,124);line(12,68,124);
  box(12,78,58,65);text('店铺一角 / 饮品照片',16,106,2.7,soft);
  ['点了什么','风味与口感','氛围与音乐'].forEach((s,i)=>{section(s,80,78+i*23,56);line(80,94+i*23,56);});
  section('想记住的细节 / 下次想尝试',12,158,124);rule(12,176,124,3,10);
 } else if(id==='annual_calendar') {
  for(let m=1;m<=12;m++)miniCalendar(`${year}-${String(m).padStart(2,'0')}`,12+((m-1)%3)*43,51+Math.floor((m-1)/3)*37,38,33,undated);
 } else if(['annual_plan','anniversaries'].includes(id)) {
  for(let i=0;i<12;i++){
   const x=12+(i%2)*65,y=51+Math.floor(i/2)*24;
   box(x,y,59,5.5);text(`${i+1} 月`,x+2,y+.7,2.6);rule(x,y+13,59,2,7);
  }
 } else if(['monthly_grid','monthly_log'].includes(id)) {
  const x=12,y=60,cw=124/7,rh=id==='monthly_log'?15:18;
  labels.forEach((s,i)=>{box(x+i*cw,50,cw,7);text(s,x+i*cw+4.5,51.5,2.7);});
  if(id==='monthly_grid')for(let i=0;i<42;i++)grid(x+i%7*cw+1,y+Math.floor(i/7)*rh+6,cw-2,rh-7,4);
  for(let c=0;c<=7;c++)line(x+c*cw,y,.18,rh*6);for(let r=0;r<=6;r++)line(x,y+r*rh,124);
  if(!undated)monthCells(monthKey,start).forEach((d,i)=>{if(d)text(d,x+i%7*cw+1.4,y+Math.floor(i/7)*rh+1.2,2.5);});
  if(id==='monthly_log')table(['习惯','第1周','第2周','第3周','第4周','第5周','第6周'],[28,16,16,16,16,16,16],{y:159,rows:3,rh:10});
  else{section('本月备注',12,177,124);rule(12,191,124,2,8);}
 } else if(id==='monthly_project') {
  text('用横线标记持续时间，用圆点标记关键日期',12,49,2.7,soft);
  const cw=3,x=43,y=62;
  box(12,y,124,8);text('项目 / 事项',14,y+2,2.7);
  for(let d=1;d<=31;d++){
   if(d<=count)text(d,x+(d-1)*cw+.2,y+2,1.9);else box(x+(d-1)*cw,y,cw,108,'#F0EFEC');
  }
  for(let c=0;c<=31;c++)line(x+c*cw,y+8,.14,100);
  for(let r=0;r<=10;r++){line(12,y+8+r*10,124);if(r<10)text(`项目 ${r+1}`,14,y+11+r*10,2.5);}
  line(12,y,.18,108);section('下一步 / 风险与调整',12,182,124);line(12,198,124);
 } else if(['weekly_vertical','study_week','weekly_routine'].includes(id)) {
  const x=22,cw=114/7,y=62,rh=4.6;
  labels.forEach((s,i)=>{box(x+i*cw,50,cw,10);text(s,x+i*cw+3.5,51,2.4);if(!undated&&id!=='weekly_routine')text(short(week()[i]),x+i*cw+3.5,55,2.1);});
  for(let r=0;r<24;r++){text(`${String(r).padStart(2,'0')}`,12,y+r*rh+.4,2.2,soft);line(x,y+r*rh,114);}
  line(x,y+24*rh,114);for(let c=0;c<=7;c++)line(x+c*cw,y,.16,24*rh);
  section(id==='study_week'?'科目色标 / 本周目标':'本周重点 / 调整',12,180,124);
  if(id==='study_week')for(let i=0;i<4;i++){box(12+i*31,191,3,3,[t.accent,'#D4E2DC','#DFDCEC','#E8D8C8'][i]);text(`科目 ${i+1}`,17+i*31,190.5,2.5);}
  else rule(12,194,124,2,7);
 } else if(id==='weekly_notes') {
  for(let i=0;i<7;i++){const y=51+i*20;box(12,y,18,18);text(labels[i],14,y+2,2.7);if(!undated)text(short(week()[i]),14,y+9,2.3);rule(33,y+8,38,2,8);}
  section('随手记',81,51,55);grid(81,63,55,136,4);
 } else if(id==='day_split') {
  text('时间',12,51,2.6);section('计划 / 工作',26,51,52);section('实际 / 生活',84,51,52);
  for(let h=0;h<24;h++){const y=63+h*5.2;text(String(h).padStart(2,'0')+':00',12,y,2.2,soft);line(26,y+4,52);line(84,y+4,52);}
  text('今天的一句话：',12,193,2.8);line(39,199,97);
 } else if(id==='month_cover') {
  box(12,53,124,75);text(undated?'新的一个月':String(monthN).padStart(2,'0'),24,63,18);text('放一张照片，或贴上喜欢的素材',24,108,3,soft);
  section('这个月的关键词',12,139,124);line(12,155,124);
  section('三件想完成的事',12,166,124);for(let i=0;i<3;i++){checkbox(12,178+i*8);line(18,181+i*8,118);}
 } else if(id==='month_week') {
  miniCalendar(monthKey,12,51,58,62);section('本月重点',80,51,56);rule(80,66,56,6,8);
  for(let i=0;i<7;i++){const y=121+i*11;box(12,y,23,9);text(labels[i]+(undated?'':' '+short(week()[i])),14,y+2,2.5);line(39,y+7,97);}
 } else if(id==='study_2weeks') {
  const startDay=week()[0],cw=7,x=38,y=61;
  box(12,y,124,14);text('科目',14,y+5,2.7);
  for(let c=0;c<14;c++){text(labels[c%7].slice(1),x+c*cw+2,y+1,2.3);const d=new Date(startDay.getTime()+c*86400000);if(!undated)text(short(d),x+c*cw+.8,y+7,2);}
  for(let r=0;r<6;r++)text(`科目 ${r+1}`,14,y+19+r*15,2.6);
  for(let r=0;r<=6;r++)line(12,y+14+r*15,124);for(let c=0;c<=14;c++)line(x+c*cw,y+14,.15,90);
  section('查漏补缺 / 下一轮复习',12,177,124);rule(12,191,124,2,8);
 } else if(id==='study_todo') {
  for(let i=0;i<7;i++){const y=51+i*19;box(12,y,124,6);text(labels[i]+(undated?'':' '+short(week()[i])),14,y+1,2.6);text('用时：______',109,y+1,2.4);checkbox(14,y+10);line(21,y+13,51);checkbox(80,y+10);line(87,y+13,47);}
  section('本周完成 / 下周调整',12,189,124);line(12,201,124);
 } else if(id==='study_day') {
  section('今天的学习目标',12,51,124);line(12,66,124);
  table(['科目','具体任务','预计','实际','完成'],[21,61,15,15,12],{y:77,rows:8,rh:10});
  section('疑问与收获',12,177,124);rule(12,191,124,2,8);
 } else if(id==='timetable') {
  table(['节次',...labels],[12,16,16,16,16,16,16,16],{rows:8,rh:15,prefill:Array.from({length:8},(_,i)=>[String(i+1)])});
  text('本学期备注：',12,190);line(37,197,99);
 } else if(id==='wishlist100') {
  for(let c=0;c<4;c++)for(let r=0;r<25;r++){const x=12+c*31.5,y=51+r*5.8;text(String(c*25+r+1).padStart(3,'0'),x,y,2.2,soft);line(x+7,y+4,22);}
 } else if(['goals','year_review','study_goal','study_review'].includes(id)) {
  const titles={goals:['学习与成长','工作与创造','健康与休息','关系与陪伴','体验与兴趣','今年的一小步'],year_review:['最有成就感的事','难忘的相遇','新学会的东西','遇到的困难','想继续保持的习惯','写给明年的自己'],study_goal:['想达成的目标','为什么值得努力','现在的起点','接下来三步','检查时间与标准','需要的支持'],study_review:['本次完成了什么','最有效的方法','还没解决的问题','时间花在哪里','下一次怎样调整','给自己的鼓励']}[id];
  titles.forEach((s,i)=>{const x=12+(i%2)*65,y=51+Math.floor(i/2)*49;section(s,x,y,59);rule(x,y+17,59,4,8);});
 } else if(id==='budget') {
  table(['项目','计划收入','实际收入','计划支出','实际支出'],[28,24,24,24,24],{rows:10,rh:10});
  section('月末核对与调整',12,174,124);rule(12,188,124,2,10);
 } else if(id==='quotes') {
  for(let i=0;i<4;i++){const y=51+i*37;box(12,y,1,29,t.accent);text('摘录 / 出处：',17,y,2.7);rule(17,y+13,119,3,8);}
 } else if(id==='family') {
  const node=(label,x,y,w)=>{box(x,y,w,17);text(label,x+3,y+2,2.7);line(x+3,y+12,w-6);};
  [12,44,76,108].forEach((x,i)=>node(`长辈 ${i+1}`,x,58,28));
  line(26,77,.2,10);line(58,77,.2,10);line(26,87,32);line(42,87,.2,10);
  line(90,77,.2,10);line(122,77,.2,10);line(90,87,32);line(106,87,.2,10);
  node('家人 A',25,98,35);node('家人 B',89,98,35);line(42,117,.2,10);line(106,117,.2,10);line(42,127,64);line(74,127,.2,10);node('我 / 关注的人',52,138,44);
  section('家庭故事 / 其他重要关系',12,170,124);rule(12,185,124,3,7);
 } else if(id==='memories') {
  for(let i=0;i<2;i++){const y=51+i*76;box(12,y,55,62);text('照片 / 画面',23,y+26,3,soft);section('时间 · 地点',77,y,59);rule(77,y+16,59,6,8);}
 } else if(id==='personal') {
  ['姓名 / 称呼','生日','联系方式','重要地址','紧急联系人','其他备注'].forEach((s,i)=>{const y=53+i*22;text(s,12,y,3);line(43,y+7,93);});
 } else if(['grid','dot','ruled','blank'].includes(id)) {
  if(id==='grid')grid(12,51,124,148,4);
  if(id==='dot')for(let y=51;y<=199;y+=5)for(let x=12;x<=136;x+=5)box(x,y,.3,.3,stroke);
  if(id==='ruled')rule(12,57,124,21,7);
 } else {
  const tables={
   scores:[['日期','考试 / 科目','目标分','实际分','复盘'],[20,38,18,18,30]],
   reading:[['书名','作者','完成日期','印象 / 页码'],[38,25,23,38]],
   movies:[['片名','观看日期','评分','一句感想'],[38,25,15,46]],
   recommendations:[['推荐内容','推荐人','日期','体验 / 备注'],[38,25,23,38]],
   gifts:[['日期','对象','送出 / 收到','礼物与心意'],[20,24,25,55]],
   promises:[['约定内容','和谁','日期 / 期限','进展'],[45,24,30,25]],
   life_plan:[['阶段 / 年份','希望的生活','行动','回看'],[25,42,35,22]],
   timeline:[['年份 / 日期','发生的事','感受 / 影响'],[26,50,48]],
   travel:[['日期','国家 / 城市','足迹与回忆'],[24,38,62]],
   contacts:[['姓名 / 机构','关系','联络方式','备注'],[27,20,42,35]],
   assets:[['项目','金额 / 数量','保管位置','核对日期'],[34,28,35,27]],
   health:[['日期','事项 / 症状','就诊记录','后续安排'],[20,34,35,35]],
   hints:[['用途 / 服务','账号提示','恢复方式 / 备注'],[32,40,52]],
   index:[['页码','主题','日期','关键词'],[16,45,25,38]],
  };
  const config=tables[id];if(!config)throw new Error('这类内页暂不可用');
  table(...config,{rows:13,rh:10});
  text('补充：',12,195,2.7);line(24,200,112);
 }
 return {version:1,page:{size:'A5',orientation:'portrait',dpi:300,bleed_mm:0,crop_marks:false},background:{type:'color',value:'#FFFFFF',tile:false},layers};
}
