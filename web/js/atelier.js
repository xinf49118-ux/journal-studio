import {makeShapeLayer,makeTextLayer,makeMaterialLayer,lighten} from './core.js';

export const atelierThemes=[
 {id:'calm',name:'清爽日常',ink:'#294a55',accent:'#427e91',paper:'#fffefa',idea:'给计划留出余量，把执行过程也记下来'},
 {id:'collect',name:'沿途采集',ink:'#514a3b',accent:'#8b7452',paper:'#fffdf5',idea:'从路线、感官和物件的来历收藏生活'},
 {id:'home',name:'温暖小屋',ink:'#654b44',accent:'#b57e68',paper:'#fffaf3',idea:'照顾空间，也照顾自己的日常节奏'},
];
export const atelierLayouts=[
 ['parallel','三线并行日','日程安排','day','计划、实际与精力并排，找到自己的节奏','calm'],
 ['buffer','缓冲周计划','日程安排','week','给必须完成、缓冲和临时插入分别留位','calm'],
 ['start','启动阻力清单','清单与回顾','none','把任务拆成最小动作，写下启动条件','calm'],
 ['capacity','负荷平衡月','日程安排','month','先盘点时间，再分配承诺与空闲','calm'],
 ['senses','路线与感官','旅行收藏','day','一条路线，五种感官，一份现场证据','collect'],
 ['object','物件来历卡','旅行收藏','none','收藏来源、材质、使用痕迹与故事','collect'],
 ['season','季节采样册','自然观察','none','观察光线、植物、声音和触感的变化','collect'],
 ['echo','旅后回声','清单与回顾','none','把预期、实际和意外收获放在一起','collect'],
 ['care','小屋维护地图','长期记录','none','从空间区域安排维护频率和下一步','home'],
 ['restore','补能菜单','长期记录','none','按可用时间与当下需要选择小事','home'],
 ['people','关系关怀页','长期记录','none','记住小事，把关心变成温柔的行动','home'],
 ['meal','一餐一刻','日记拼贴','day','记录食材、过程，也安排剩余食物','home'],
].map(([key,name,group,period,subtitle,atelier])=>({id:'atelier_'+key,name,group,period,subtitle,atelier}));

// Functional fields remain native text and shape layers; decorative art is optional.
export function atelierProject(o,materials,layout,dates){
 const t=atelierThemes.find(t=>t.id===layout.atelier),layers=[];
 const pale=lighten(t.accent,.89),rule=lighten(t.ink,.72);
 const rect=(x,y,w,h,fill=pale)=>layers.push(makeShapeLayer({x_mm:x,y_mm:y,w_mm:w,h_mm:h,fill}));
 const text=(s,x,y,size=2.8,color=t.ink)=>layers.push(makeTextLayer({text:s,x_mm:x,y_mm:y,size_mm:size,color}));
 const line=(x,y,w,h=.17)=>rect(x,y,w,h,rule);
 const notes=(x,y,w,n=3,step=7)=>{for(let i=0;i<n;i++)line(x,y+i*step,w);};
 const card=(label,x,y,w,h)=>{rect(x,y,w,7);text(label,x+2,y+1.4,2.6);notes(x+2,y+16,w-4,Math.max(1,Math.floor((h-15)/7)));};
 const table=(heads,widths,y,rows,rh)=>{let x=12;heads.forEach((s,i)=>{rect(x,y,widths[i],8);text(s,x+2,y+2,2.6);line(x,y,.17,8+rows*rh);x+=widths[i];});line(136,y,.17,8+rows*rh);for(let r=0;r<=rows;r++)line(12,y+8+r*rh,124);};
 text(t.name+' / 原创内页',12,10,2.4);text(layout.name,12,20,6);rect(12,32,30,.7,t.accent);
 text(layout.subtitle,12,37,2.65);
 let date='日期：________';
 if(!o.undated&&layout.period!=='none'){
  const raw=layout.period==='month'?`${o.month??(o.date??dates.todayString()).slice(0,7)}-01`:(o.date??dates.todayString());
  dates.parseDate(raw);date=layout.period==='month'?raw.slice(0,7):layout.period==='week'?'本周起点 '+dates.weekDates(raw,Number(o.weekStart)===0?0:1)[0].toISOString().slice(0,10):raw;
 }
 text(date,12,45,2.5);
 switch(layout.id){
 case 'atelier_parallel':
  table(['时段','计划','实际','精力 / 原因'],[16,36,36,36],55,8,13);
  ['清晨','上午','午前','午后','傍晚','晚间','睡前','弹性'].forEach((s,i)=>text(s,14,67+i*13,2.5));
  card('哪种安排更适合我？',12,177,124,25);break;
 case 'atelier_buffer':
  table(['日期','必须完成的一件事','预留缓冲','临时插入'],[19,48,28,29],55,7,15);
  (o.undated?(Number(o.weekStart)===0?['日','一','二','三','四','五','六']:['一','二','三','四','五','六','日']):dates.weekDates(o.date??dates.todayString(),Number(o.weekStart)===0?0:1).map(d=>`${d.getUTCMonth()+1}/${d.getUTCDate()}`)).forEach((s,i)=>text(s,14,69+i*15));
  card('这周可以放下什么？',12,179,124,23);break;
 case 'atelier_start':
  table(['想做的事','最小动作','准备什么','何时开始'],[34,35,30,25],55,8,14);
  text('先试一次，再决定要不要继续。',12,187,3);break;
 case 'atelier_capacity':
  text('本月固定占用：________________   可支配时间：________',12,55,2.7);
  table(['周段','可用时间','已承诺','留白 / 缓冲'],[22,32,34,36],67,5,19);
  for(let i=0;i<5;i++)text(`第 ${i+1} 周`,14,81+i*19);
  card('需要调整的承诺 / 主动留出的空间',12,179,124,23);break;
 case 'atelier_senses':
  card('从哪里出发 → 经过哪里 → 停在哪里（可画路线）',12,55,124,47);
  ['看见','听见','闻到','触到','尝到'].forEach((s,i)=>{rect(12,108+i*12,19,9);text(s,15,110+i*12);line(34,116+i*12,102);});
  card('现场证据：票根、照片或一句原话',12,175,124,27);break;
 case 'atelier_object':
  card('物件画像 / 照片 / 拓印',12,55,58,80);
  ['名称','来自哪里','何时遇见','材质 / 触感','磨损 / 特征'].forEach((s,i)=>{text(s,77,57+i*15,2.5);line(77,67+i*15,59);});
  card('它的故事 / 我为什么留下它',12,144,124,58);break;
 case 'atelier_season':
  ['一束光','一种植物','一种声音','一种触感'].forEach((s,i)=>card(s,12+i%2*65,55+Math.floor(i/2)*55,59,49));
  card('和上次相比，什么变了？  观察地点：________',12,171,124,31);break;
 case 'atelier_echo':
  card('出发前的预期',12,55,59,63);card('真实发生的事',77,55,59,63);
  card('意料之外的收获',12,125,124,35);card('想再去的理由 / 下次会改变的安排',12,168,124,34);break;
 case 'atelier_care':
  ['入口','起居','厨房','浴室','睡眠','其他'].forEach((s,i)=>card(s,12+i%3*42,55+Math.floor(i/3)*31,39,26));
  table(['区域 / 物件','维护动作','频率','下次日期'],[34,40,25,25],122,4,15);break;
 case 'atelier_restore':
  table(['可用时间','身体需要','头脑需要','情绪需要'],[22,34,34,34],55,3,30);
  ['5 分钟','15 分钟','30 分钟'].forEach((s,i)=>text(s,14,75+i*30,2.6));
  card('今天想尝试：',12,162,59,40);card('做完以后的感觉：',77,162,59,40);break;
 case 'atelier_people':
  table(['名字 / 关系','想记住的小事','可以做的关心','合适的时间'],[27,36,36,25],55,6,19);
  text('不必频繁，也可以真诚。',12,187,3);break;
 case 'atelier_meal':
  card('今天的一餐 / 照片 / 小画',12,55,67,61);card('食材与用量',85,55,51,61);
  card('过程 / 火候 / 下次想调整的地方',12,123,124,37);
  card('剩下什么？',12,168,59,34);card('下一餐怎么用？',77,168,59,34);break;
 }
 const art=materials.find(m=>m.id===`sticker_atelier_${t.id}_hero`);
 if(art)layers.push(makeMaterialLayer(art,{x_mm:116,y_mm:8,w_mm:20,h_mm:20}));
 return {version:1,page:{size:'A5',orientation:'portrait',dpi:300,bleed_mm:0,crop_marks:false},background:{type:'color',value:t.paper,tile:false},layers};
}
