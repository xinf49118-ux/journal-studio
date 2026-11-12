/* Original raster tools. Results are ordinary portable PNGs, not screen-only filters. */
import {cropCanvas,patternSlots} from './craft-layout.js';
const limit=(v,a,b)=>Math.max(a,Math.min(b,Number(v)));
export function inkPixels(data,{color='#855b53',density=.85,wear=.2,seed=17}={}){
 if(!/^#[0-9a-f]{6}$/i.test(color)||![density,wear,seed].every(Number.isFinite))throw new Error('印泥参数无效');
 const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));density=limit(density,0,1);wear=limit(wear,0,1);let n=seed>>>0;
 for(let i=0;i<data.length;i+=4){n=(Math.imul(n,1664525)+1013904223)>>>0;const r=n/4294967296,a=data[i+3];data[i]=rgb[0];data[i+1]=rgb[1];data[i+2]=rgb[2];data[i+3]=Math.round(a*density*(r<wear*.4?0:1-wear*r*.65));}return data;
}
export function clearEdgeWhite(data,w,h,threshold=242){
 if(data.length!==w*h*4||!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1)throw new Error('图片尺寸无效');
 const seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let head=0,tail=0;
 const add=i=>{if(seen[i])return;seen[i]=1;const p=i*4;if(data[p+3]<8||Math.min(data[p],data[p+1],data[p+2])>=threshold)queue[tail++]=i;};
 for(let x=0;x<w;x++){add(x);add((h-1)*w+x);}for(let y=0;y<h;y++){add(y*w);add(y*w+w-1);}
 while(head<tail){const i=queue[head++];data[i*4+3]=0;if(i%w)add(i-1);if(i%w<w-1)add(i+1);if(i>=w)add(i-w);if(i<w*(h-1))add(i+w);}return data;
}
const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
export function stampCanvas({text='今天也有小进步',date='',shape='rect',sizeMm=40,color='#855b53',density=.85,wear=.2,ghost=0,seed=17}={}){
 if(!['rect','round','ticket'].includes(shape)||!Number.isFinite(Number(sizeMm))||sizeMm<15||sizeMm>100)throw new Error('印章宽度需在15—100mm');
 const w=Math.round(Number(sizeMm)*300/25.4),h=shape==='round'?w:Math.round(w*.62),c=canvas(w,h),ctx=c.getContext('2d'),pad=w*.06;
 ctx.strokeStyle='#000';ctx.fillStyle='#000';ctx.lineWidth=w*.008;ctx.textAlign='center';ctx.textBaseline='middle';
 if(shape==='round'){ctx.beginPath();ctx.arc(w/2,h/2,w*.43,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(w/2,h/2,w*.39,0,Math.PI*2);ctx.stroke();}
 else {ctx.strokeRect(pad,pad,w-pad*2,h-pad*2);if(shape==='ticket'){ctx.setLineDash([w*.018,w*.014]);ctx.strokeRect(pad*1.6,pad*1.6,w-pad*3.2,h-pad*3.2);ctx.setLineDash([]);}}
 const lines=String(text).slice(0,80).split(/\r?\n/).slice(0,3),extra=String(date).trim().slice(0,24),all=[...lines,...(extra?[extra]:[])];
 const maxW=w*(shape==='round'?.66:.78),fs=Math.min(w*.12,h*.5/Math.max(1,all.length));
 all.forEach((s,i)=>{let n=fs;ctx.font=`${n}px "Microsoft YaHei",sans-serif`;while(ctx.measureText(s).width>maxW&&n>5){n-=1;ctx.font=`${n}px "Microsoft YaHei",sans-serif`;}ctx.fillText(s,w/2,h/2+(i-(all.length-1)/2)*fs*1.5);});
 const px=ctx.getImageData(0,0,w,h);inkPixels(px.data,{color,density,wear,seed});ctx.putImageData(px,0,0);
 if(ghost>0){const copy=canvas(w,h);copy.getContext('2d').drawImage(c,0,0);ctx.globalAlpha=.22;const shift=limit(ghost,0,1)*w*.018;ctx.drawImage(copy,shift,shift*.55);ctx.globalAlpha=1;}return c;
}
export function effectCanvas(image,{effect='paper',color='#855b53',density=.85,wear=.2,ghost=0,seed=17,removeWhite=false,outlineMm=.6,shadow=.25,referenceMm=40,...cropOptions}={}){
 if(!['paper','pet','washi','stamp'].includes(effect))throw new Error('请选择可用效果');
 if(![outlineMm,shadow,referenceMm].every(Number.isFinite)||outlineMm<0||outlineMm>3||shadow<0||shadow>1||referenceMm<=0)throw new Error('白边或阴影参数无效');
 const cropped=cropCanvas(image,cropOptions),src=cropped.canvas,w=src.width,h=src.height,s=src.getContext('2d');
 const px=s.getImageData(0,0,w,h);if(removeWhite)clearEdgeWhite(px.data,w,h);
 if(effect==='stamp')inkPixels(px.data,{color,density,wear,seed});
 if(effect==='pet'||effect==='washi')for(let i=0;i<px.data.length;i+=4){if(effect==='washi')for(let k=0;k<3;k++)px.data[i+k]=Math.round(px.data[i+k]*.88+250*.12);px.data[i+3]=Math.round(px.data[i+3]*(effect==='pet'?.72:.62));}
 s.putImageData(px,0,0);const border=Math.min(120,outlineMm*w/(referenceMm*cropped.crop.w)),pad=effect==='paper'?Math.ceil(border*1.8+(shadow?5:1)):Math.ceil(Math.max(w,h)*.025),out=canvas(w+pad*2,h+pad*2),ctx=out.getContext('2d');
 if(effect==='paper'){
  const mask=canvas(w+pad*2,h+pad*2),m=mask.getContext('2d'),r=border;
  for(let a=0;a<Math.PI*2;a+=Math.PI/12)m.drawImage(src,pad+Math.cos(a)*r,pad+Math.sin(a)*r);
  m.drawImage(src,pad,pad);m.globalCompositeOperation='source-in';m.fillStyle='#fffdf8';m.fillRect(0,0,mask.width,mask.height);
  ctx.shadowColor=`rgba(81,67,55,${shadow})`;ctx.shadowBlur=pad*.35;ctx.shadowOffsetY=pad*.2;ctx.drawImage(mask,0,0);ctx.shadowColor='transparent';
 }
 ctx.drawImage(src,pad,pad);if(effect==='stamp'&&ghost>0){ctx.globalAlpha=.22;ctx.drawImage(src,pad+limit(ghost,0,1)*pad*.6,pad+limit(ghost,0,1)*pad*.35);ctx.globalAlpha=1;}return {canvas:out,pad,sourceWidth:w,sourceHeight:h,crop:cropped.crop};
}
export function patternCanvas(image,options={}){
 const plan=patternSlots(options),cropped=cropCanvas(image,options).canvas,ppm=300/25.4,out=canvas(Math.round(plan.w*ppm),Math.round(plan.h*ppm)),ctx=out.getContext('2d');
 if(options.patternInk!==false){const m=cropped.getContext('2d'),px=m.getImageData(0,0,cropped.width,cropped.height);inkPixels(px.data,options);m.putImageData(px,0,0);}
 for(const slot of plan.slots){const ratio=cropped.width/cropped.height,ww=slot.side*Math.min(1,ratio)*ppm,hh=slot.side*Math.min(1,1/ratio)*ppm;ctx.save();ctx.translate(slot.x*ppm,slot.y*ppm);ctx.rotate(slot.angle*Math.PI/180);ctx.drawImage(cropped,-ww/2,-hh/2,ww,hh);ctx.restore();}return out;
}
export function pngBlob(c){return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('图片生成失败')),'image/png'));}
