import test from 'node:test';import assert from 'node:assert/strict';import {inkPixels,clearEdgeWhite} from '../web/js/craft.js';
test('ink preserves transparent background and deterministic texture, density and tint',()=>{
 const data=new Uint8ClampedArray([10,20,30,0,0,0,0,255,255,255,255,128]),a=inkPixels(data.slice(),{color:'#123456',density:.5,wear:0});assert.deepEqual([...a],[18,52,86,0,18,52,86,128,18,52,86,64]);
 assert.deepEqual(inkPixels(data.slice(),{wear:.8,seed:45}),inkPixels(data.slice(),{wear:.8,seed:45}));assert.throws(()=>inkPixels(data,{color:'bad'}));
});
test('white removal only removes white connected to edges, preserving enclosed highlights',()=>{
 const w=5,h=5,a=new Uint8ClampedArray(w*h*4).fill(255);for(let y=1;y<4;y++)for(let x=1;x<4;x++)if(x!==2||y!==2)a.set([50,60,70,255],(y*w+x)*4);clearEdgeWhite(a,w,h);assert.equal(a[3],0);assert.equal(a[(2*w+2)*4+3],255);assert.equal(a[(1*w+1)*4+3],255);assert.throws(()=>clearEdgeWhite(a,4,5));
});
