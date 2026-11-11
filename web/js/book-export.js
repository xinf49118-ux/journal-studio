import {bookPage,bookPrintPage} from './book.js';
import {PAGE_SIZES} from './core.js';
import {renderToJpeg} from './render.js';
import {buildPdf} from './pdf.js';
const pause=()=>new Promise(r=>setTimeout(r,0));
export async function exportBook(plan,{signal,onProgress=()=>{},render=renderToJpeg}={}){
 const images=[];let bytes=0;
 const check=()=>{if(signal?.aborted)throw new DOMException('已取消导出','AbortError');};
 for(let i=0;i<plan.pages.length;i++){
  check();const image=await render(bookPrintPage(bookPage(plan,i),plan.options.paper));check();
  bytes+=image.jpeg.byteLength;if(bytes>180_000_000)throw new Error('整册文件过大，请缩短日期范围分册导出');
  images.push(image);onProgress(i+1,plan.pages.length);await pause();
 }
 check();const [pageWmm,pageHmm]=plan.options.paper==='a4'?[210,297]:PAGE_SIZES[plan.options.size];
 const pdf=buildPdf(images,{pageWmm,pageHmm,dpi:300,title:plan.options.title});
 await pause();check();return pdf;
}
