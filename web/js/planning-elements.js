import {makeShapeLayer,makeTextLayer,uid} from './core.js';

// Each entry describes an editable structure, not a raster template.
const groups=[
 ['项目推进',[
  ['milestones','里程碑图','timeline','按开始日期和跨度标出节点；数值每行填写一天偏移。'],
  ['roadmap','项目路线图','roadmap','阶段卡片与推进箭头，节点名称、日期跨度可改。'],
  ['dependencies','任务依赖图','tree','节点名称一行一个；连接填“起点编号,终点编号”，不允许循环依赖。'],
  ['phase_progress','阶段进度条','bars','每行一个阶段，数值填写已完成量；按目标值计算进度。']]],
 ['目标拆解',[
  ['goal_tree','目标树','tree','从根目标拆成分支；可自填节点与连接，切换横向／纵向。'],
  ['mandala','九宫格目标表','mandala','中心目标与周边行动；可改为3—6行列的目标宫格。'],
  ['goal_steps','目标阶梯','steps','一行一个步骤，按完成比例给阶梯填色。'],
  ['goal_breakdown','年季月目标拆解','tree','年度→季度→月度→行动；可改节点及层级连接。']]],
 ['时间安排',[
  ['dual_timeline','双时间轴','dual','两条轨道比较计划和实际；数值第1、2行分别填各节点的天偏移。'],
  ['countdown','倒计时日历','countdown','从开始日期逐日倒排至D0；天数可调。'],
  ['pomodoro','番茄钟记录','pomodoro','任务按行，每格一个番茄钟；数值每行填写已完成个数。'],
  ['plan_actual','计划与实际对照图','compare','数值每行填写“计划,实际”；目标值为共同坐标上限。']]],
 ['习惯养成',[
  ['habit_chain','连续打卡链','chain','连续日期蛇形排列；填色记录，不把空白当成失败。'],
  ['habit_wheel','周期习惯轮盘','wheel','周期天数与环数可改，每个扇区可单独填色。'],
  ['habit_points','习惯积分表','points','数值每行填“完成次数,每次积分”，有数据时计算总分。'],
  ['habit_loop','触发行动奖励循环','cycle','用循环箭头连接触发、行动与奖励；节点可改。']]],
 ['学习复习',[
  ['spaced_review','间隔复习表','review','按开始日期和所填间隔排复习日；数值第一行是各次间隔天数。'],
  ['knowledge_tree','知识树','tree','把知识点与子主题连接，所有节点文字可编辑。'],
  ['exam_countdown','考试倒排表','countdown','逐日倒计时并保留阶段备注；调整开始日期和周期。'],
  ['error_matrix','错题复盘矩阵','table','按题目记录原因、改进与复测；表内文字生成后可继续填写。']]],
 ['状态记录',[
  ['mood_curve','情绪曲线','curve','每个时点填一个0到目标值之间的分数；留空处不连线。'],
  ['sleep_band','睡眠时间带','sleep','每行填“入睡小时,睡眠时长”，例如23,8；自动拆分跨午夜区段。'],
  ['energy_map','精力热力图','heatmap','每行填各时段的分数；空白格保留未知，0分仍是有效记录。'],
  ['event_correlation','事件与状态对照表','table','把日期、事件与状态并列记录，不自动推断因果。']]],
 ['生活平衡',[
  ['life_wheel','生活之轮','life-wheel','列标题为生活维度，数值第一行填各维度分数；目标值是满分。'],
  ['time_ring','时间分配圆环','time-ring','列标题为活动，数值第一行填时长，按比例分区；留空生成等分底图。'],
  ['life_scores','生活领域评分表','bars','每行一个生活领域，数值填写评分；目标值为满分。']]],
 ['选择与决策',[
  ['pros_cons','优缺点对照表','table','左右并列记录好处、代价与待确认事项。'],
  ['decision_matrix','加权决策矩阵','decision','每行一个指标，数值填“权重,方案1评分,方案2评分…”；计算加权均分。'],
  ['effort_return','投入产出矩阵','scatter','每行一个方案，数值填“投入,收益”；目标值为坐标上限。'],
  ['decision_tree','决策树','tree','条件与分支可自定，连接使用节点编号，不允许环路。']]],
 ['思考复盘',[
  ['mind_map','思维导图','radial-map','中心主题与周边分支，可用连接编号增加交叉联系。'],
  ['fishbone','鱼骨图','fishbone','把原因写在分支上，标题作为待分析的问题。'],
  ['cause_chain','事件因果链','chain-nodes','顺序节点与箭头，可修改为自己的事件链；不自动判断因果。'],
  ['retro','开始停止继续复盘','table','三个分区记录开始、停止与继续的行动。']]],
 ['财务储蓄',[
  ['savings_grid','储蓄进度格','savings','目标金额平均分到每格，按完成比例填色；单位可改。'],
  ['debt_plan','债务偿还表','debt','数值每行填“期初欠款,已还金额”，计算剩余金额。'],
  ['bill_calendar','账单日历','calendar','使用月份生成真实日期；行标题可填“日:账单内容”。'],
  ['budget_actual','预算与实际对照表','budget','数值每行填“预算,实际”，计算差额及合计。']]],
 ['阅读创作',[
  ['reading_progress','阅读进度条','bars','每行一本书，填写已读页数与共同目标页数；也可改用百分比。'],
  ['reading_map','读书地图','radial-map','中心书名、人物、观点与疑问可自由连结。'],
  ['story_timeline','故事时间线','timeline','按事件和日期偏移排列情节节点，可切换横竖方向。'],
  ['publish_calendar','创作发布日历','calendar','使用月份生成日历；行标题填“日:发布内容”。']]],
 ['人际活动',[
  ['relationship_map','关系地图','radial-map','中心人物与周边关系，可自定义交叉连接。'],
  ['contact_tracker','联系频率表','contacts','联系人按行、日期按列；每格独立填写或填色。'],
  ['event_plan','活动筹备表','table','任务、负责人、截止时间与状态并列记录。'],
  ['travel_timeline','旅行行程时间带','travel','行标题写地点活动，起始小时与步长控制时刻；可横向或纵向。']]]
];
export const planningSpecs=Object.fromEntries(groups.flatMap(([category,items])=>items.map(([id,name,family,help])=>[id,{name,category,family,help}])));
export const planningTypes=Object.fromEntries(Object.entries(planningSpecs).map(([id,s])=>[id,s.name]));
export const planningPresets=Object.fromEntries(Object.entries(planningSpecs).map(([id,s])=>[id,{w:120,h:100,rows:5,cols:4,rowLabels:'',colLabels:'',values:'',links:'',direction:'horizontal',target:100,progress:0,periodDays:30,unit:'',...(
 s.family==='tree'?{rows:7}:s.family==='radial-map'?{rows:7}:s.family==='cycle'?{rows:3}:
 s.family==='life-wheel'?{cols:8,target:10}:s.family==='time-ring'?{cols:5,target:24,unit:'小时'}:
 s.family==='curve'||s.family==='scatter'||s.family==='heatmap'?{target:10}:
 s.family==='decision'?{rows:3,cols:3,target:10}:s.family==='mandala'?{rows:3,cols:3}:
 s.family==='savings'?{rows:10,cols:10,target:10000,unit:'元'}:s.family==='review'?{rows:5,values:'1,3,7,14,30'}:
 s.family==='chain'?{cols:7,periodDays:30}:s.family==='wheel'?{periodDays:21,rings:3}:
 s.family==='contacts'?{cols:7}:id==='reading_progress'?{target:300,unit:'页'}:id==='goal_breakdown'?{rows:4}:{}
)}]));
// A deliberate linear default for year → quarter → month → action.
planningPresets.goal_breakdown.rows=4;

const number=(value,label,min,max,integer=false)=>{const n=Number(value);if(!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n)))throw new Error(`${label}需在${min}—${max}之间${integer?'且为整数':''}`);return n;};
const lines=v=>String(v??'').split(/\r?\n/).map(s=>s.trim());
const titles=v=>lines(v).filter(Boolean);
export function planningDate(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value)))throw new Error('开始日期格式应为年-月-日');
 const d=new Date(value+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==value||d.getUTCFullYear()<1900||d.getUTCFullYear()>2199)throw new Error('开始日期无效，年份需在1900—2199之间');return d;
}
export function planningValues(value){
 const rows=lines(value);if(rows.length>40)throw new Error('数值最多40行');return rows.map(row=>row.split(/[,，]/).map(v=>{v=v.trim();if(!v)return null;const n=Number(v);if(!Number.isFinite(n)||Math.abs(n)>1e9)throw new Error('数值需为有效数字，空格可留空');return n;}));
}
// Preview-only sample inputs. Inserting a component uses empty records instead.
export function planningExample(type){
 const f=planningSpecs[type]?.family;
 const examples={
  bars:{rows:3,rowLabels:'阶段一\n阶段二\n阶段三',values:'80\n45\n0'},
  compare:{rows:3,rowLabels:'周一\n周二\n周三',values:'60,50\n40,65\n80,75'},
  decision:{rows:3,cols:2,colLabels:'方案A\n方案B',rowLabels:'成本\n质量\n便利',values:'2,6,9\n3,9,6\n1,7,8'},
  curve:{rows:7,rowLabels:'一\n二\n三\n四\n五\n六\n日',values:'4\n7\n\n0\n5\n8\n6'},
  scatter:{rows:4,rowLabels:'方案A\n方案B\n方案C\n方案D',values:'2,8\n7,3\n4,5\n8,9'},
  sleep:{rows:4,values:'23,8\n0.5,7\n22,8.5\n23.5,6.5'},
  heatmap:{rows:4,cols:4,values:'0,3,8,5\n2,,5,7\n4,9,6,2\n3,5,7,4'},
  'life-wheel':{cols:6,colLabels:'健康\n学习\n关系\n工作\n休息\n兴趣',values:'8,6,4,7,5,9'},
  'time-ring':{cols:5,colLabels:'睡眠\n工作\n通勤\n生活\n自由',values:'8,8,1,4,3'},
  points:{rows:3,values:'3,2\n5,1\n2,4'},debt:{rows:3,values:'1000,200\n500,100\n800,300'},budget:{rows:3,values:'100,80\n200,240\n150,100'},
  pomodoro:{rows:4,values:'3\n1\n0\n4'},savings:{progress:35},steps:{progress:40},
  calendar:{rowLabels:'3:准备\n12:完成\n24:检查'},dual:{rows:4,values:'0,8,16,29\n0,10,20,28'}
 };
 return {type,startDate:'2026-11-01',month:'2026-11',...(examples[f]||{})};
}
export function planningLinks(value,count,{acyclic=false}={}){
 const edges=[],seen=new Set();for(const row of titles(value)){
  const p=row.split(/[,，]/).map(v=>Number(v.trim()));if(p.length!==2||p.some(v=>!Number.isInteger(v)||v<1||v>count)||p[0]===p[1])throw new Error('连接格式：起点编号,终点编号；编号不能相同或超出节点数');const key=p.join(',');if(seen.has(key))throw new Error('连接不能重复');seen.add(key);edges.push(p.map(v=>v-1));
 }
 if(edges.length>64)throw new Error('最多64条连接');
 if(acyclic){const visiting=new Set(),done=new Set(),visit=i=>{if(visiting.has(i))throw new Error('层级或依赖连接不能形成环路');if(done.has(i))return;visiting.add(i);for(const [a,b] of edges)if(a===i)visit(b);visiting.delete(i);done.add(i);};for(let i=0;i<count;i++)visit(i);}
 return edges;
}

export function planningElement(o,{line:lineMaker}){
 const spec=planningSpecs[o.type];if(!spec)throw new Error('未知规划组件');
 const x=number(o.x??12,'横向位置',0,420),y=number(o.y??45,'纵向位置',0,420),w=number(o.w,'宽度',60,400),h=number(o.h,'高度',45,400),rows=number(o.rows??5,'行数',1,40,true),cols=number(o.cols??4,'列数',1,40,true),stroke=number(o.stroke??.25,'线宽',.1,2),font=number(o.labelSize??2.4,'标签字号',1.5,6),color=o.color??'#7d8980';
 if(!/^#[0-9a-f]{6}$/i.test(color))throw new Error('颜色无效');if(!['horizontal','vertical'].includes(o.direction??'horizontal'))throw new Error('排列方向无效');
 const vertical=o.direction==='vertical',target=number(o.target??100,'目标值／满分',.01,1e9),progress=number(o.progress??0,'完成比例',0,100),period=number(o.periodDays??30,'周期天数',1,366,true),unit=String(o.unit??'').slice(0,12),rn=titles(o.rowLabels),cn=titles(o.colLabels),data=planningValues(['table','calendar'].includes(spec.family)?'':o.values),out=[];
 const title=String(o.text&&o.text!=='我的标题'?o.text:spec.name),date=()=>planningDate(o.startDate||'2026-01-01'),day=(d,n)=>{const z=new Date(+d+n*86400000);return `${z.getUTCMonth()+1}/${z.getUTCDate()}`;},fmt=n=>Number(n.toFixed(2)).toString();
 const tint=(score=0)=>{const t=Math.max(0,Math.min(1,score));return '#'+[1,3,5].map(i=>Math.round(255+(parseInt(color.slice(i,i+2),16)-255)*t).toString(16).padStart(2,'0')).join('');};
 const box=(a,b,c,d,fill='#ffffff00',role='cell',label='',shape='rect')=>{if(c<=0||d<=0)return;out.push({...makeShapeLayer({shape,x_mm:a,y_mm:b,w_mm:c,h_mm:d,fill,stroke:color,stroke_mm:stroke}),design_role:role,design_label:label});};
 const line=(a,b,c,d)=>{if(Math.hypot(c-a,d-b)>=.3)out.push(...lineMaker(a,b,c,d,{color,stroke,dashed:!!o.dashed}));};
 const text=(s,a,b,width=w,size=font)=>{const n=Math.max(1,Math.floor(width/size));out.push({...makeTextLayer({text:[...String(s)].slice(0,n).join(''),x_mm:a,y_mm:b,size_mm:size,color}),design_label:String(s)});};
 const arrow=(a,b,c,d)=>{line(a,b,c,d);const ang=Math.atan2(d-b,c-a),r=1.8;line(c,d,c-r*Math.cos(ang-.5),d-r*Math.sin(ang-.5));line(c,d,c-r*Math.cos(ang+.5),d-r*Math.sin(ang+.5));};
 const valid=(n,label,min=0,max=target)=>n===null||n===undefined?null:number(n,label,min,max);
 const pair=(r,min=0,max=1e9)=>[valid(data[r]?.[0],'第一项数值',min,max),valid(data[r]?.[1],'第二项数值',min,max)];
 const heading=()=>text(title,x,y,w,Math.min(font+1,4));heading();const top=y+10,H=h-10;
 function table(rowTitles,colTitles,values=[],footer=''){
  const n=rowTitles.length,c=colTitles.length,left=Math.min(27,w*.26),cw=(w-left)/c,rh=(H-(footer?9:0))/(n+1);if(rh<4||cw<8)throw new Error('表格过密，请加大尺寸或减少行列');
  colTitles.forEach((s,i)=>text(s,x+left+i*cw+1,top+1,cw-2,Math.min(font,cw/5)));rowTitles.forEach((s,r)=>{text(s,x+1,top+(r+1)*rh+1,left-2,Math.min(font,rh/2));for(let c=0;c<colTitles.length;c++){box(x+left+c*cw,top+(r+1)*rh,cw,rh,'#ffffff00','cell',`${s} · ${colTitles[c]}`);const v=values[r]?.[c];if(v!==null&&v!==undefined&&v!=='')text(v,x+left+c*cw+1,top+(r+1)*rh+1,cw-2,Math.min(font,rh/2));}});
  for(let r=0;r<=n+1;r++)line(x,top+r*rh,x+w,top+r*rh);
  line(x,top,x,top+(n+1)*rh);for(let i=0;i<=c;i++)line(x+left+i*cw,top,x+left+i*cw,top+(n+1)*rh);if(footer)text(footer,x, y+h-6,w,Math.min(font,2.5));
 }
 const labels=(defaults,count=rows)=>Array.from({length:count},(_,i)=>rn[i]||(defaults.length===1?defaults[0]+(i+1):defaults[i%defaults.length])||`项目${i+1}`);
 const f=spec.family;
 const dimensions={bars:[rn.length||rows,1],compare:[rn.length||rows,2],points:[rn.length||rows,2],debt:[rn.length||rows,2],budget:[rn.length||rows,2],curve:[rn.length||rows,1],sleep:[rn.length||rows,2],heatmap:[rn.length||rows,cn.length||cols],scatter:[rn.length||rows,2],pomodoro:[rn.length||rows,1],decision:[rn.length||rows,(cn.length||cols)+1],'life-wheel':[1,cn.length||cols],'time-ring':[1,cn.length||cols],timeline:[1,rn.length||rows],roadmap:[1,rn.length||rows],dual:[2,rn.length||rows]};
 if(dimensions[f]){const [r,c]=dimensions[f];if(data.some((row,i)=>row.some((v,j)=>v!==null&&(i>=r||j>=c))))throw new Error(`当前组件接收${r}行、每行${c}个数值，请调整行列或数据`);}
 if(f==='tree'||f==='radial-map'||f==='cycle'||f==='chain-nodes'){
  const defaults=o.type==='goal_breakdown'?['年度目标','季度目标','月度目标','本周行动']:f==='cycle'?['触发','行动','奖励']:o.type==='decision_tree'?['待决策问题','条件一','条件二','选择A','选择B','选择C','选择D']:['中心主题','分支一','分支二','行动一','行动二','行动三','行动四'];
  const n=Math.max(2,Math.min(16,rn.length||rows)),names=labels(defaults,n);if(rn.length>16||rows>16)throw new Error('节点最多16个');
  let edges=planningLinks(o.links,n,{acyclic:f==='tree'||f==='chain-nodes'});if(!edges.length)edges=Array.from({length:n-1},(_,i)=>[f==='chain-nodes'||o.type==='goal_breakdown'?i:f==='tree'?Math.floor(i/2):0,i+1]);if(f==='cycle'&&!String(o.links||'').trim())edges=Array.from({length:n},(_,i)=>[i,(i+1)%n]);
  let pts=[],nw,nh;
  if(f==='radial-map'||f==='cycle'){
   const cx=x+w/2,cy=top+H/2,Rx=w*.34,Ry=H*.35;nw=Math.min(24,w/4);nh=8;
   pts=Array.from({length:n},(_,i)=>{if(f==='radial-map'&&i===0)return[cx,cy];const a=((f==='cycle'?i:i-1)/(f==='cycle'?n:n-1)*2*Math.PI-Math.PI/2);return[cx+Math.cos(a)*Rx,cy+Math.sin(a)*Ry];});
  }else{
   const depth=Array(n).fill(0);for(let k=0;k<n;k++)for(const [a,b] of edges)depth[b]=Math.max(depth[b],depth[a]+1);const max=Math.max(...depth),buckets=Array.from({length:max+1},(_,d)=>depth.map((v,i)=>v===d?i:-1).filter(i=>i>=0));
   nw=Math.min(25,vertical?w/(Math.max(...buckets.map(a=>a.length))+1):w/(max+1)*.75);nh=Math.min(8,vertical?H/(max+1)*.65:H/(Math.max(...buckets.map(a=>a.length))+1)*.7);
   if(nw<8||nh<3)throw new Error('节点过密，请减少层级或加大尺寸');pts=depth.map((d,i)=>{const a=buckets[d],j=a.indexOf(i);return vertical?[x+w*(j+1)/(a.length+1),top+H*(d+.5)/(max+1)]:[x+w*(d+.5)/(max+1),top+H*(j+1)/(a.length+1)];});
  }
  for(const [a,b] of edges){const [ax,ay]=pts[a],[bx,by]=pts[b],dx=bx-ax,dy=by-ay,tA=Math.min(Math.abs(nw/2/(dx||1e-8)),Math.abs(nh/2/(dy||1e-8))),tB=tA;arrow(ax+dx*tA,ay+dy*tA,bx-dx*tB,by-dy*tB);}
  pts.forEach(([a,b],i)=>{box(a-nw/2,b-nh/2,nw,nh,'#ffffff','cell',names[i]);text(names[i],a-nw/2+1,b-Math.min(font,nh/2)/2,nw-2,Math.min(font,nh/2));});
 }else if(['timeline','roadmap','dual','travel'].includes(f)){
  const n=rn.length||rows;if(n>16)throw new Error('时间线最多16个节点');const names=labels(f==='travel'?['出发','交通','参观','用餐','入住']:['开始','调研','制作','检查','完成'],n),start=date(),tracks=f==='dual'?2:1;
  for(let track=0;track<tracks;track++){
   const axis=vertical?x+w*(track+.5)/tracks:top+H*(track+.5)/tracks;
   if(vertical)arrow(axis,top+5,axis,top+H-4);else arrow(x+5,axis,x+w-4,axis);
   if(tracks===2)text(cn[track]||['计划','实际'][track],vertical?axis+2:x,vertical?top:axis-10,w/2,Math.min(font,2.5));
   for(let i=0;i<n;i++){const raw=data[track]?.[i],offset=raw===null||raw===undefined?i*(period-1)/Math.max(1,n-1):valid(raw,'节点天偏移',0,period-1),ratio=(offset/(Math.max(1,period-1)))*.8+.1,a=vertical?axis:x+w*ratio,b=vertical?top+H*ratio:axis,space=vertical?H/n:w/n;
    if(f==='roadmap'){const bw=vertical?w*.62:Math.min(25,space*.85),bh=vertical?Math.min(9,space*.75):12;box(a-bw/2,b-bh/2,bw,bh,'#ffffff','cell',names[i]);text(names[i],a-bw/2+1,b-bh/2+1,bw-2,Math.min(font,2.2));}
    else{box(a-1,b-1,2,2,color,'cell',names[i],'ellipse');text(names[i],vertical?a+4:a-space*.4,vertical?b-2:b+4,vertical?w/tracks*.4:space*.85,Math.min(font,space/4));}
    const clock=number(o.startHour??8,'起始小时',0,23.75)*60+i*number(o.stepMinutes??60,'时间步长',15,180),stamp=f==='travel'?`${String(Math.floor(clock/60)%24).padStart(2,'0')}:${String(clock%60).padStart(2,'0')}`:day(start,Math.round(offset));text(stamp,vertical?a-w/tracks*.35:a-space*.35,vertical?b-2:b-6,vertical?w/tracks*.32:space*.7,Math.min(font,2));
   }
  }
 }else if(f==='bars'||f==='compare'){
  const n=rn.length||rows;if(n>12)throw new Error('进度条最多12行');const names=labels(o.type==='reading_progress'?['书名一','书名二','书名三']:o.type==='life_scores'?['健康','学习','工作','关系','休息']:['阶段一','阶段二','阶段三','阶段四','阶段五'],n),rh=H/n,left=Math.min(28,w*.28),bw=w-left-3;
  names.forEach((s,r)=>{const yy=top+r*rh;text(s,x,yy,left-2,Math.min(font,rh/3));const vals=f==='compare'?pair(r,0,target):[valid(data[r]?.[0],'已完成量')],bh=Math.min(5,rh/(f==='compare'?6:3));
   vals.forEach((v,j)=>{const a=x+left,b=yy+j*rh/2;box(a,b,bw,bh,'#ffffff00','cell',s+(j?'实际':'计划'));if(v!==null&&v>0)box(a,b,bw*v/target,bh,tint(j?.75:.35),'cell',`${s} ${fmt(v)}`);if(v!==null)text(`${j===1?'实际 ':f==='compare'?'计划 ':''}${fmt(v)}${unit}`,a,b+bh+.5,bw,Math.min(font,2));});
  });
 }else if(f==='mandala'||f==='savings'){
  const r=f==='mandala'?number(rows,'目标宫格行数',3,6,true):rows,c=f==='mandala'?number(cols,'目标宫格列数',3,6,true):cols,footer=f==='savings'?8:0,cw=w/c,rh=(H-footer)/r;if(cw<3||rh<3)throw new Error('格子过密，请增加尺寸');const done=Math.floor(r*c*progress/100);
  for(let a=0;a<r;a++)for(let b=0;b<c;b++){const i=a*c+b,center=a===Math.floor(r/2)&&b===Math.floor(c/2);box(x+b*cw,top+a*rh,cw,rh,f==='mandala'&&center?tint(.2):i<done?tint(.65):'#ffffff00','cell',`第${i+1}格`);text(rn[i]||(f==='savings'?fmt(target/(r*c))+unit:center?'中心目标':`行动${i+1}`),x+b*cw+.8,top+a*rh+1,cw-1.6,Math.min(font,rh/3,cw/5));}
  if(f==='savings')text(`目标 ${fmt(target)}${unit} · 已填 ${done}/${r*c} 格`,x,y+h-5,w,Math.min(font,2.5));
 }else if(f==='steps'){
  const n=rn.length||rows;if(n>12)throw new Error('阶梯最多12级');for(let i=0;i<n;i++){const cw=w/n,rh=H/n,a=x+i*cw,b=top+H-(i+1)*rh;box(a,b,cw,(i+1)*rh,i<Math.floor(n*progress/100)?tint(.5):'#ffffff00','cell',rn[i]||`步骤${i+1}`);text(rn[i]||`步骤${i+1}`,a+1,b+1,cw-2,Math.min(font,cw/4));}
 }else if(f==='countdown'||f==='chain'){
  if(f==='chain'&&period>120)throw new Error('打卡链最多120天，请拆成多个周期');const c=Math.min(cols,14),r=Math.ceil(period/c),cw=w/c,rh=(H-(o.type==='exam_countdown'?7:0))/r,start=date();if(cw<7||rh<5)throw new Error('日期格过密，请加大尺寸或缩短周期');
  for(let i=0;i<period;i++){const rr=Math.floor(i/c),cc=f==='chain'&&rr%2?c-1-i%c:i%c,a=x+cc*cw,b=top+rr*rh;
   if(f==='chain'){const size=Math.min(cw,rh)*.65;box(a+(cw-size)/2,b+(rh-size)/2,size,size,'#ffffff00','cell',day(start,i),'ellipse');text(i+1,a+cw/2-size*.25,b+rh/2-font*.5,size,Math.min(font,size/3));if(i<period-1){const nr=Math.floor((i+1)/c),nc=nr%2?c-1-(i+1)%c:(i+1)%c;if(nr===rr)line(a+cw/2+(nr%2?-size/2:size/2),b+rh/2,x+nc*cw+cw/2+(nr%2?size/2:-size/2),b+rh/2);} }
   else{box(a,b,cw,rh,'#ffffff00','cell',day(start,i));text(`D${period-1-i?'-'+(period-1-i):'0'}`,a+1,b+1,cw-2,Math.min(font,rh/3));text(day(start,i),a+1,b+rh*.55,cw-2,Math.min(font,2));}
  }if(o.type==='exam_countdown')text('阶段 / 本周重点：________________',x,y+h-5,w,Math.min(font,2.4));
 }else if(['wheel','life-wheel','time-ring'].includes(f)){
  const n=f==='wheel'?number(period,'周期天数',3,62,true):number(cn.length||cols,'维度数',3,16,true),rings=f==='time-ring'?1:number(o.rings??3,'圈数',1,6,true),cx=x+w/2,cy=top+H/2,R=Math.min(w,H)/2-9;if(R<10)throw new Error('圆盘尺寸太小');const vals=data[0]||[],has=vals.some(v=>v!==null),weights=f==='time-ring'&&has?Array.from({length:n},(_,i)=>valid(vals[i],'活动时长',0,1e9)??0):Array(n).fill(1),total=weights.reduce((a,b)=>a+b,0);if(total<=0)throw new Error('时长合计需大于0');let angle=0;
  for(let i=0;i<n;i++){const sweep=weights[i]/total*360,start=angle;angle+=sweep;if(!sweep)continue;const score=f==='life-wheel'?valid(vals[i],'维度分数'):null;
   if(score!==null&&score>0){const outer=R*(.2+.8*score/target);out.push({...makeShapeLayer({shape:'sector',x_mm:cx-outer,y_mm:cy-outer,w_mm:outer*2,h_mm:outer*2,fill:tint(.5)}),start_deg:start,end_deg:angle,inner_ratio:R*.2/outer,design_role:'cell',design_label:`${cn[i]||'维度'+(i+1)} · ${score}/${target}`});}
   for(let r=0;r<rings;r++){const inner=R*(.2+r*.8/rings),outer=R*(.2+(r+1)*.8/rings);out.push({...makeShapeLayer({shape:'sector',x_mm:cx-outer,y_mm:cy-outer,w_mm:2*outer,h_mm:2*outer,fill:'#ffffff00',stroke:color,stroke_mm:stroke}),start_deg:start,end_deg:angle,inner_ratio:inner/outer,design_role:'cell',design_label:f==='wheel'?`第${i+1}天 · 环${r+1}`:cn[i]||`维度${i+1}`});}
   const a=((start+angle)/2-90)*Math.PI/180;text(f==='wheel'?i+1:cn[i]||`维度${i+1}`,cx+Math.cos(a)*(R+4)-4,cy+Math.sin(a)*(R+4)-1,9,Math.min(font,2));
  }
 }else if(f==='review'){
  const gaps=(data[0]||[]).filter(v=>v!==null);if(!gaps.length||gaps.length>10)throw new Error('请填写1—10个复习间隔');gaps.forEach(n=>number(n,'复习间隔天数',0,3650,true));const start=date();table(labels(['学习项目'],rows),gaps.map(n=>'+'+n+'天'),Array.from({length:rows},()=>gaps.map(n=>day(start,n))),'按所填间隔排期，可自行修改；不保证记忆效果');
 }else if(f==='pomodoro'||f==='contacts'){
  const n=rn.length||rows,c=cols;if(n*c>300)throw new Error('追踪格最多300格');const left=Math.min(25,w*.25),cw=(w-left)/c,rh=H/(n+1),start=date();if(cw<4||rh<4)throw new Error('追踪格过密');
  for(let j=0;j<c;j++)text(f==='contacts'?day(start,j):j+1,x+left+j*cw,top,cw-1,Math.min(font,cw/3));for(let i=0;i<n;i++){text(rn[i]||(f==='contacts'?`联系人${i+1}`:`任务${i+1}`),x,top+(i+1)*rh,left-1,Math.min(font,rh/2));const done=f==='pomodoro'?valid(data[i]?.[0],'已完成番茄钟',0,c):null;if(done!==null&&!Number.isInteger(done))throw new Error('番茄钟数量需为整数');for(let j=0;j<c;j++){const size=Math.min(cw,rh)*.72;box(x+left+j*cw+.5,top+(i+1)*rh+.5,size,size,done!==null&&j<done?tint(.6):'#ffffff00','cell',`${i+1}行${j+1}格`,f==='pomodoro'?'ellipse':'rect');}}
 }else if(f==='sleep'){
  const n=rn.length||rows,left=20,bw=w-left,rh=H/(n+1);if(n>16||rh<3)throw new Error('睡眠记录最多16行，请加大高度');for(let j=0;j<=24;j+=4)text(j,x+left+bw*j/24-1,top,8,2);
  for(let i=0;i<n;i++){const yy=top+(i+1)*rh;text(rn[i]||day(date(),i),x,yy,left-1,Math.min(font,rh/2));box(x+left,yy,bw,rh*.65,'#ffffff00','cell',`睡眠${i+1}`);const start=valid(data[i]?.[0],'入睡小时',0,23.99),duration=valid(data[i]?.[1],'睡眠时长',.01,24);if((start===null)!==(duration===null))throw new Error('睡眠记录需要同时填写入睡小时和时长');if(start!==null){const first=Math.min(duration,24-start);box(x+left+bw*start/24,yy,bw*first/24,rh*.65,tint(.55),'cell',`睡眠${i+1} · 午夜前`);if(duration>first)box(x+left,yy,bw*(duration-first)/24,rh*.65,tint(.55),'cell',`睡眠${i+1} · 午夜后`);}}
 }else if(f==='heatmap'){
  const n=rn.length||rows,c=cn.length||cols,left=18,cw=(w-left)/c,rh=H/(n+1);if(n*c>300||cw<3||rh<3)throw new Error('热力格过密');cn.length?cn.forEach((s,i)=>text(s,x+left+i*cw,top,cw-1,Math.min(font,cw/3))):Array.from({length:c},(_,i)=>text(`时段${i+1}`,x+left+i*cw,top,cw-1,Math.min(font,cw/4)));
  for(let i=0;i<n;i++){text(rn[i]||day(date(),i),x,top+(i+1)*rh,left-1,Math.min(font,rh/2));for(let j=0;j<c;j++){const v=valid(data[i]?.[j],'精力分数');box(x+left+j*cw,top+(i+1)*rh,cw,rh,v===null?'#ffffff00':tint(.12+.8*v/target),'cell',v===null?'未记录':`分数 ${v}`);if(v!==null)text(fmt(v),x+left+j*cw+1,top+(i+1)*rh+1,cw-2,Math.min(font,rh/3));}}
 }else if(f==='curve'||f==='scatter'){
  const left=12,bottom=9,gw=w-left,gh=H-bottom,cx=x+left,cy=top+gh;for(let j=0;j<=4;j++){line(cx,top+gh*j/4,x+w,top+gh*j/4);text(fmt(target*(1-j/4)),x,top+gh*j/4-1,10,2);}arrow(cx,cy,x+w,cy);arrow(cx,cy,cx,top);if(f==='scatter'){line(cx+gw/2,top,cx+gw/2,cy);text('投入 →',cx+gw/2,y+h-5,gw/2,2);text('收益 ↑',cx,top,20,2);}
  const n=rn.length||rows;if(n>30)throw new Error('图表最多30个点');let previous=null;
  for(let i=0;i<n;i++){const a=f==='curve'?i*target/Math.max(1,n-1):valid(data[i]?.[0],'投入'),b=valid(data[i]?.[f==='curve'?0:1],'记录分数');if(f==='curve'&&(n<=15||i%Math.ceil(n/15)===0))text(rn[i]||i+1,Math.min(x+w-6,cx+gw*i/Math.max(1,n-1)),cy+2,Math.min(12,gw/Math.min(n,15)),Math.min(font,2));if(a===null||b===null){previous=null;continue;}const px=cx+gw*a/target,py=cy-gh*b/target;if(f==='curve'&&previous)line(...previous,px,py);box(px-.7,py-.7,1.4,1.4,color,'cell',rn[i]||`记录${i+1}`,'ellipse');text(rn[i]||i+1,Math.max(cx,Math.min(x+w-8,px+1)),Math.max(top,py-4),8,Math.min(font,2));previous=[px,py];}
 }else if(f==='fishbone'){
  const n=Math.min(12,rn.length||rows),mid=top+H/2;arrow(x,mid,x+w-20,mid);text(o.text&&o.text!=='我的标题'?o.text:'待分析问题',x+w-19,mid-2,19,Math.min(font,2.2));for(let i=0;i<n;i++){const a=x+8+Math.floor(i/2)*(w-35)/Math.ceil(n/2),sign=i%2?1:-1,b=mid+sign*H*.35;arrow(a,b,a+10,mid);text(rn[i]||`原因${i+1}`,a-5,b+(sign>0?1:-5),22,Math.min(font,2.2));}
 }else if(f==='calendar'){
  const month=String(o.month||'2026-01');planningDate(month+'-01');const start=new Date(month+'-01T00:00:00Z'),days=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate(),offset=(start.getUTCDay()+6)%7,nRows=Math.ceil((offset+days)/7),cw=w/7,rh=(H-6)/nRows,notes=new Map();
  for(const s of rn){const m=/^(\d{1,2})[:：](.+)$/.exec(s);if(!m||+m[1]<1||+m[1]>days)throw new Error('日历事项格式：日:内容，日期须在所选月份内');notes.set(+m[1],(notes.get(+m[1])||'')+m[2]+' ');}
  ['一','二','三','四','五','六','日'].forEach((s,i)=>text(s,x+i*cw+1,top,cw-2,2.2));for(let d=1;d<=days;d++){const i=d-1+offset,a=x+(i%7)*cw,b=top+6+Math.floor(i/7)*rh;box(a,b,cw,rh,'#ffffff00','cell',month+'-'+d);text(d,a+1,b+1,cw-2,Math.min(font,2.2));if(notes.has(d))text(notes.get(d),a+1,b+rh*.45,cw-2,Math.min(font,2));}
 }else if(f==='decision'){
  const n=rn.length||rows,c=cn.length||cols;if(n>12||c>8)throw new Error('决策矩阵最多12个指标、8个方案');const values=[],totals=Array(c).fill(0),weightTotals=Array(c).fill(0);for(let i=0;i<n;i++){const weight=valid(data[i]?.[0],'权重',0,1e6),scores=Array.from({length:c},(_,j)=>valid(data[i]?.[j+1],'方案评分'));values.push([weight===null?'':fmt(weight),...scores.map(v=>v===null?'':fmt(v))]);for(let j=0;j<c;j++)if(weight!==null&&scores[j]!==null){totals[j]+=weight*scores[j];weightTotals[j]+=weight;}}
  const complete=Array.from({length:c},(_,j)=>Array.from({length:n},(_,i)=>data[i]?.[0]!==null&&data[i]?.[0]!==undefined&&data[i]?.[j+1]!==null&&data[i]?.[j+1]!==undefined).every(Boolean));values.push(['',...totals.map((v,j)=>!complete[j]?'未填全':weightTotals[j]>0?fmt(v/weightTotals[j]):'权重为0')]);table([...labels(['指标'],n),'加权均分'],['权重',...Array.from({length:c},(_,i)=>cn[i]||`方案${i+1}`)],values);
 }else if(['points','debt','budget'].includes(f)){
  const n=rn.length||rows,values=[],sum=[0,0,0];let complete=true;for(let i=0;i<n;i++){const [a,b]=pair(i);if(a===null||b===null)complete=false;if(f==='debt'&&a!==null&&b!==null&&b>a)throw new Error('已还金额不能超过期初欠款');const result=a===null||b===null?null:f==='points'?a*b:f==='debt'?a-b:a-b;values.push([a,b,result].map(v=>v===null?'':fmt(v)));[a,b,result].forEach((v,j)=>{if(v!==null)sum[j]+=v;});}
  table(labels(f==='points'?['习惯']:f==='debt'?['债务项目']:['支出项目'],n),f==='points'?['完成次数','每次积分','积分']:f==='debt'?['期初欠款','已还金额','剩余欠款']:['预算','实际','差额'],values,complete?f==='points'?`总积分 ${fmt(sum[2])}`:`合计 ${sum.map(fmt).join(' / ')}${unit}`:'合计：尚有未填项');
 }else if(f==='table'){
  const defaults={error_matrix:['错因','改进','复测日期'],event_correlation:['日期','事件','状态'],pros_cons:['优点','缺点','待确认'],retro:['开始','停止','继续'],event_plan:['任务','负责人','截止日期','状态']}[o.type]||['记录一','记录二','记录三'];const colNames=cn.length?cn:defaults,raw=lines(o.values).map(s=>s.split(/[,，]/).map(v=>v.trim())),n=rn.length||rows;if(raw.some((row,i)=>row.some((v,j)=>v&&(i>=n||j>=colNames.length))))throw new Error('文字表格数据超出行列，请调整行列或数据');table(labels(o.type==='event_correlation'?['记录']:['项目'],n),colNames,raw);
 }
 if(out.length>900)throw new Error('组件超过900个图层，请减少行列或周期');const group=uid('G');return out.map(l=>({...l,group_id:group,name:l.design_label||spec.name}));
}
