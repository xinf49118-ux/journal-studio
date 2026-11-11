import {PAGE_SIZES,pageDims} from './core.js';
// Uniform scaling preserves photo proportions and editable layer coordinates.
export function fitProject(project,size,orientation=project.page.orientation) {
 if(!PAGE_SIZES[size])throw new Error('不支持的纸张尺寸');
 const p=structuredClone(project),[w,h]=pageDims(p.page);
 p.page.size=size;p.page.orientation=orientation;const [nw,nh]=pageDims(p.page),scale=Math.min(nw/w,nh/h),dx=(nw-w*scale)/2,dy=(nh-h*scale)/2;
 for(const l of p.layers){l.x_mm=l.x_mm*scale+dx;l.y_mm=l.y_mm*scale+dy;
  for(const k of ['w_mm','h_mm','size_mm','stroke_mm'])if(typeof l[k]==='number')l[k]*=scale;
 }
 return p;
}
