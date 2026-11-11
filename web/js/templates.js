import {makeMaterialLayer, makeShapeLayer, makeTextLayer} from './core.js';

export const templates = [
 {id:'cafe',name:'咖啡日常',subtitle:'一杯咖啡，一页慢生活',bg:'#FFF5E7',ink:'#875D44',accent:'#EACBAA',title:'今日的小确幸'},
 {id:'garden',name:'花园来信',subtitle:'留一点空白，记录生长',bg:'#F4F6EA',ink:'#537558',accent:'#D9E3CE',title:'把日子种成花'},
 {id:'travel',name:'慢游记',subtitle:'收藏路上的风景与故事',bg:'#EFF4F6',ink:'#526F85',accent:'#CCDDE5',title:'下一站，好风景'},
 {id:'cats',name:'猫咪午后',subtitle:'把柔软的时光留下来',bg:'#FFF3ED',ink:'#98755F',accent:'#EAD6DB',title:'今天也要好好生活'},
 {id:'sky',name:'星空梦境',subtitle:'给愿望留一个位置',bg:'#F2F0FA',ink:'#6D6B99',accent:'#DBD8ED',title:'写给明天的自己'},
 {id:'party',name:'节庆心愿',subtitle:'值得纪念的每个小日子',bg:'#FFF4EC',ink:'#A76570',accent:'#EBD1D5',title:'快乐值得被记录'},
];

export function templateProject(t, materials) {
 const layers=[];
 const shape=(x,y,w,h,fill)=>layers.push(makeShapeLayer({x_mm:x,y_mm:y,w_mm:w,h_mm:h,fill}));
 const text=(value,x,y,size=4)=>layers.push(makeTextLayer({text:value,x_mm:x,y_mm:y,size_mm:size,color:t.ink}));
 const art=(i,x,y,w=27)=>{
   const m=materials.find(m=>m.id.endsWith(`_collection_${t.id}_${String(i).padStart(2,'0')}`));
   if(m)layers.push(makeMaterialLayer(m,{x_mm:x,y_mm:y,w_mm:w,h_mm:w*m.h/m.w}));
 };
 shape(9,9,130,192,'#fffdf9');text(t.name.toUpperCase(),17,18,3);text(t.title,17,29,6);
 if(t.id==='travel') {
   shape(17,54,70,88,t.accent);text('旅途照片 / 小票',24,90,4);art(0,93,58,36);art(1,100,101,28);
   text('地点：________  日期：________',17,151,3.4);text('路上的故事',17,166,4);art(6,105,170,27);
 } else if(t.id==='sky') {
   art(0,96,48,29);art(5,20,51,33);shape(20,94,108,70,t.accent);
   text('想完成的三件小事',27,104,4);text('01  __________________\n02  __________________\n03  __________________',27,120,3.8);text('慢慢来，也是在向前。',27,178,4);art(2,105,172,19);
 } else if(t.id==='party') {
   art(7,18,48,110);shape(24,89,100,68,t.accent);text('今天，值得庆祝！',34,106,5);text('日期：________\n愿望：________________',34,125,3.6);art(0,19,166,30);art(2,92,164,33);
 } else {
   const split=t.id==='cats';
   shape(17,57,split?68:114,57,t.accent);text(split?'午后的碎片':'这里放照片或写下心情',23,78,4);
   art(0,split?90:95,split?61:93,35);art(1,18,160,31);art(6,102,161,28);
   text(t.id==='garden'?'今日观察':'值得收藏的瞬间',20,125,4);
   for(let i=0;i<3;i++)shape(20,140+i*9,106,.35,t.accent);
   text('记下平凡日子里的光。',52,183,3);
 }
 art(10,17,45,50);
 return {version:1,page:{size:'A5',orientation:'portrait',dpi:300,bleed_mm:3,crop_marks:true},background:{type:'color',value:t.bg,tile:false},layers};
}
