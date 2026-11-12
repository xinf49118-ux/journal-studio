import test from 'node:test';import assert from 'node:assert/strict';import {inkPixels,clearEdgeWhite} from '../web/js/craft.js';
import {cropRect,effectPlacement,patternSlots,sheetLayout} from '../web/js/craft-layout.js';
test('ink preserves transparent background and deterministic texture, density and tint',()=>{
 const data=new Uint8ClampedArray([10,20,30,0,0,0,0,255,255,255,255,128]),a=inkPixels(data.slice(),{color:'#123456',density:.5,wear:0});assert.deepEqual([...a],[18,52,86,0,18,52,86,128,18,52,86,64]);
 assert.deepEqual(inkPixels(data.slice(),{wear:.8,seed:45}),inkPixels(data.slice(),{wear:.8,seed:45}));assert.throws(()=>inkPixels(data,{color:'bad'}));
});
test('percentage crops reject overflow and preserve pixel boundaries',()=>{
 assert.deepEqual(cropRect(200,100,{cropX:50,cropW:50}),{left:100,top:0,width:100,height:100,x:.5,y:0,w:.5,h:1});
 for(const crop of [{cropX:60,cropW:50},{cropH:0},{cropY:100},{cropW:NaN}])assert.throws(()=>cropRect(200,100,crop));
});
test('cropped image placement follows existing rotation and flips without stretching',()=>{
 const source={x_mm:20,y_mm:30,w_mm:40,h_mm:20,rotate:90,flip_x:true},result={sourceWidth:100,sourceHeight:100,canvas:{width:110,height:110},crop:{x:.5,y:0,w:.5,h:1}};
 const p=effectPlacement(source,result);assert.ok(Math.abs(p.x_mm-29)<1e-8&&Math.abs(p.y_mm-39)<1e-8);assert.equal(p.w_mm,22);assert.equal(p.h_mm,22);
 const unchanged=effectPlacement({...source,rotate:0,flip_x:false},{sourceWidth:200,sourceHeight:100,canvas:{width:200,height:100}});assert.deepEqual(unchanged,{x_mm:20,y_mm:30,w_mm:40,h_mm:20});
});
test('repeated motifs remain inside strip, frame and wreath at maximum density',()=>{
 for(const layout of ['strip','frame','wreath'])for(const count of [2,12,48]){const p=patternSlots({layout,count,sizeMm:80,rotation:45});assert.equal(p.slots.length,count);for(const s of p.slots){const extent=s.side/Math.sqrt(2);assert.ok(s.x-extent>=0&&s.y-extent>=0&&s.x+extent<=p.w&&s.y+extent<=p.h);}}
 assert.throws(()=>patternSlots({count:2.5}));assert.throws(()=>patternSlots({sizeMm:1000}));
});
test('actual-size sticker layout fits paper with exact margins, gap and quantity',()=>{
 const p=sheetLayout({pageW:148,pageH:210,itemW:30,itemH:30,count:12,margin:10,gap:4});assert.equal(p.length,12);assert.deepEqual(p[0],{x_mm:10,y_mm:10,w_mm:30,h_mm:30});assert.equal(p[1].x_mm,44);assert.equal(p[3].y_mm,44);assert.ok(p.every(b=>b.x_mm+b.w_mm<=138&&b.y_mm+b.h_mm<=200));
 for(const o of [{count:100},{gap:-1},{itemW:200},{count:1.2}])assert.throws(()=>sheetLayout({pageW:148,pageH:210,itemW:30,itemH:30,count:12,...o}));
});
test('white removal only removes white connected to edges, preserving enclosed highlights',()=>{
 const w=5,h=5,a=new Uint8ClampedArray(w*h*4).fill(255);for(let y=1;y<4;y++)for(let x=1;x<4;x++)if(x!==2||y!==2)a.set([50,60,70,255],(y*w+x)*4);clearEdgeWhite(a,w,h);assert.equal(a[3],0);assert.equal(a[(2*w+2)*4+3],255);assert.equal(a[(1*w+1)*4+3],255);assert.throws(()=>clearEdgeWhite(a,4,5));
});
