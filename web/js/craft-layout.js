const number=(v,name,min,max)=>{v=Number(v);if(!Number.isFinite(v)||v<min||v>max)throw new Error(`${name}需在${min}—${max}之间`);return v;};
export function cropRect(w,h,{cropX=0,cropY=0,cropW=100,cropH=100}={}){
 const x=number(cropX,'裁切左侧%',0,99.9),y=number(cropY,'裁切顶部%',0,99.9),cw=number(cropW,'裁切宽度%',.1,100),ch=number(cropH,'裁切高度%',.1,100);
 if(x+cw>100.00001||y+ch>100.00001)throw new Error('裁切范围超出图片，请减小位置或宽高');
 const left=Math.round(w*x/100),top=Math.round(h*y/100),width=Math.min(w-left,Math.max(1,Math.round(w*cw/100))),height=Math.min(h-top,Math.max(1,Math.round(h*ch/100)));
 return {left,top,width,height,x:left/w,y:top/h,w:width/w,h:height/h};
}
export function cropCanvas(image,options={}){
 const iw=image.naturalWidth||image.width,ih=image.naturalHeight||image.height;if(!iw||!ih)throw new Error('图片还没读好');const crop=cropRect(iw,ih,options),scale=Math.min(1,1600/Math.max(crop.width,crop.height)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(crop.width*scale));c.height=Math.max(1,Math.round(crop.height*scale));c.getContext('2d').drawImage(image,crop.left,crop.top,crop.width,crop.height,0,0,c.width,c.height);return {canvas:c,crop};
}
export function effectPlacement(source,result){
 const crop=result.crop||{x:0,y:0,w:1,h:1},cw=source.w_mm*crop.w,ch=source.h_mm*crop.h,sx=cw/result.sourceWidth,sy=ch/result.sourceHeight,w=result.canvas.width*sx,h=result.canvas.height*sy;
 const dx=(crop.x+crop.w/2-.5)*source.w_mm*(source.flip_x?-1:1),dy=(crop.y+crop.h/2-.5)*source.h_mm*(source.flip_y?-1:1),a=-(source.rotate||0)*Math.PI/180,cx=source.x_mm+source.w_mm/2+dx*Math.cos(a)-dy*Math.sin(a),cy=source.y_mm+source.h_mm/2+dx*Math.sin(a)+dy*Math.cos(a);
 return {x_mm:cx-w/2,y_mm:cy-h/2,w_mm:w,h_mm:h};
}
export function patternSlots({layout='strip',count=8,sizeMm=80,rotation=0}={}){
 count=number(count,'图案数量',2,48);sizeMm=number(sizeMm,'花边宽度mm',20,100);rotation=number(rotation,'图案旋转',-180,180);if(!Number.isInteger(count))throw new Error('图案数量需为整数');if(!['strip','frame','wreath'].includes(layout))throw new Error('请选择花边形式');
 const h=layout==='strip'?sizeMm*.22:sizeMm,slots=[],R=sizeMm*.35;
 for(let i=0;i<count;i++){
  let x,y,angle=rotation,side;
  if(layout==='strip'){x=sizeMm*(i+.5)/count;y=h/2;side=Math.min(sizeMm/count*.68,h*.68);}
  else if(layout==='wreath'){const a=i/count*Math.PI*2-Math.PI/2;x=sizeMm/2+Math.cos(a)*R;y=h/2+Math.sin(a)*R;angle+=i/count*360;side=Math.min(sizeMm*.18,Math.PI*2*R/count*.72);}
  else {const t=i/count*4,s=Math.floor(t),q=t-s,lo=sizeMm*.15,hi=sizeMm*.85;x=s===0?lo+(hi-lo)*q:s===1?hi:s===2?hi-(hi-lo)*q:lo;y=s===0?lo:s===1?lo+(hi-lo)*q:s===2?hi:hi-(hi-lo)*q;angle+=s*90;side=Math.min(sizeMm*.16,sizeMm*2.8/count*.72);}
  slots.push({x,y,side,angle});
 }return {w:sizeMm,h,slots};
}
export function sheetLayout({pageW,pageH,itemW,itemH,count=12,margin=10,gap=4}={}){
 pageW=number(pageW,'纸张宽',10,2000);pageH=number(pageH,'纸张高',10,2000);itemW=number(itemW,'单张宽',2,200);itemH=number(itemH,'单张高',2,400);count=number(count,'复制数量',1,100);margin=number(margin,'页边距',0,50);gap=number(gap,'间距',0,30);if(!Number.isInteger(count))throw new Error('复制数量需为整数');
 const cols=Math.floor((pageW-margin*2+gap)/(itemW+gap)),rows=Math.floor((pageH-margin*2+gap)/(itemH+gap)),capacity=Math.max(0,cols)*Math.max(0,rows);
 if(count>capacity)throw new Error(`当前尺寸最多放${capacity}张，请减小单张尺寸、间距或数量`);
 return Array.from({length:count},(_,i)=>({x_mm:margin+i%cols*(itemW+gap),y_mm:margin+Math.floor(i/cols)*(itemH+gap),w_mm:itemW,h_mm:itemH}));
}
