import {makeShapeLayer,makeTextLayer} from './core.js';
export const foldSizes={regular:{name:'常规 110 × 210 mm',w:110,h:210,perSheet:1},passport:{name:'护照 89 × 124 mm',w:89,h:124,perSheet:2}};
// A4 single-sided sheets with 10 mm joining tabs. A continuous strip is assembled
// at actual size; we do not squeeze a 210 mm panel onto a borderless A4 landscape.
export function foldSheets({size='regular',panels=6,style='story'}={}){
 const s=foldSizes[size];if(!s||![3,6,9,12].includes(Number(panels))||!['blank','grid','story'].includes(style))throw new Error('折页选项无效');
 panels=Number(panels);const sheets=[];
 for(let first=0;first<panels;first+=s.perSheet){
  const n=Math.min(s.perSheet,panels-first),join=first+n<panels,stripW=n*s.w+(join?10:0),x=(210-stripW)/2,y=(297-s.h)/2;
  const layers=[];
  const rect=(a,b,w,h,fill='#c5c5bd')=>layers.push(makeShapeLayer({x_mm:a,y_mm:b,w_mm:w,h_mm:h,fill}));
  const text=(value,a,b,z=3)=>layers.push(makeTextLayer({text:String(value),x_mm:a,y_mm:b,size_mm:z,color:'#4c5f4e'}));
  const vertical=(a,b,h)=>{for(let d=0;d<h;d+=4)rect(a,b+d,.18,Math.min(2,h-d),'#829b89');};
  text(`连续折页 · ${size==='regular'?'常规':'护照'} · 第 ${sheets.length+1} 张`,12,10,3.4);
  text(`第 ${first+1}—${first+n} 面 / 共 ${panels} 面 · 每面 ${s.w} × ${s.h} mm`,12,18,2.7);
  rect(x,y,stripW,.2);rect(x,y+s.h,stripW,.2);rect(x,y,.2,s.h);rect(x+stripW,y,.2,s.h);
  for(let j=0;j<n;j++){
   const px=x+j*s.w,index=first+j;
   text(String(index+1).padStart(2,'0'),px+5,y+5,3);
   if(style==='grid'){
    for(let dx=5;dx<=s.w-5;dx+=5)rect(px+dx,y+15,.12,s.h-22,'#dfe6df');
    for(let dy=15;dy<=s.h-7;dy+=5)rect(px+5,y+dy,s.w-10,.12,'#dfe6df');
   }else if(style==='story'){
    text('地点 / 日期：',px+5,y+15,2.6);rect(px+5,y+24,s.w-10,.12);
    rect(px+5,y+32,s.w-10,s.h*.36,'#f1f3ed');text('照片 / 票根 / 手绘',px+8,y+38,2.6);
    const begin= y+40+s.h*.36;for(let ry=begin;ry<y+s.h-5;ry+=8)rect(px+5,ry,s.w-10,.12);
   }
   if(index<panels-1){vertical(px+s.w,y,s.h);text((index%2===0?'谷折':'山折')+' '+(index+1),px+s.w-12,y-7,2.5);}
  }
  if(join){const tx=x+n*s.w;text('接',tx+3,y+8,2.5);text('贴',tx+3,y+14,2.5);text('区',tx+3,y+20,2.5);}
  text('实线裁切 · 虚线交替折叠 · 接贴区贴在下一张左边背面',12,270,2.7);
  text('A4单面打印，实际尺寸100%；不要选择适应页面。',12,278,2.7);
  text('以下标尺应为50 mm，用尺量过再裁切：',12,286,2.5);rect(115,290,50,.25);rect(115,287,.25,3);rect(165,287,.25,3);
  sheets.push({version:1,page:{size:'A4',orientation:'portrait',dpi:300,bleed_mm:0,crop_marks:false},background:{type:'color',value:'#FFFFFF',tile:false},layers});
 }
 return sheets;
}
