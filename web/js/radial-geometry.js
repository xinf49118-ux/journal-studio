// Degrees run clockwise from twelve o'clock. Shared by stage and raster output.
export function sectorPoints(layer){
 const start=Number(layer.start_deg),end=Number(layer.end_deg),inner=Number(layer.inner_ratio??0);
 if(!Number.isFinite(start+end+inner)||end<=start||end-start>360.001||inner<0||inner>=1)throw new Error('扇区角度或内径无效');
 const n=Math.max(1,Math.ceil((end-start)/2)),point=(degree,r)=>{const a=(degree-90)*Math.PI/180;return [.5+Math.cos(a)*r,.5+Math.sin(a)*r];},points=[];
 for(let i=0;i<=n;i++)points.push(point(start+(end-start)*i/n,.5));
 if(inner>0)for(let i=n;i>=0;i--)points.push(point(start+(end-start)*i/n,inner/2));else points.push([.5,.5]);return points;
}
