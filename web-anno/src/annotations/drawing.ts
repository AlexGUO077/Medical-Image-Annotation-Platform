import type { FrameGeometry } from '../viewer/api';
import { decodeMaskInto, encodeMask, type RleMask } from './rle';
import type { Annotation, Geometry } from './types';
export type DrawingTool = Annotation['tool']|'select'|'pan'|'zoom'|'measure';
export type Point = [number,number];
export function inside(point:Point,size:FrameGeometry){return point.every(Number.isFinite)&&point[0]>=0&&point[1]>=0&&point[0]<size.width&&point[1]<size.height;}
export function clampPoint(p:Point,size:FrameGeometry):Point{return [Math.max(0,Math.min(size.width-1e-6,p[0])),Math.max(0,Math.min(size.height-1e-6,p[1]))];}
export function brushStroke(mask:RleMask|undefined,size:FrameGeometry,from:Point,to:Point,diameter:number,erase:boolean):RleMask {
 if(!size.row_spacing||!size.column_spacing||!Number.isFinite(diameter)||diameter<=0)throw new Error('毫米画笔需要有效像素间距和直径');
 const pixels=new Uint8Array(size.width*size.height);if(mask)decodeMaskInto(mask,pixels);
 const rx=diameter/(2*size.column_spacing),ry=diameter/(2*size.row_spacing);
 const dx=to[0]-from[0],dy=to[1]-from[1],steps=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))/Math.max(.5,Math.min(rx,ry,4))));
 for(let i=0;i<=steps;i++){
  const cx=from[0]+dx*i/steps,cy=from[1]+dy*i/steps;
  for(let y=Math.max(0,Math.floor(cy-ry));y<Math.min(size.height,Math.ceil(cy+ry));y++)for(let x=Math.max(0,Math.floor(cx-rx));x<Math.min(size.width,Math.ceil(cx+rx));x++)
   if(((x+.5-cx)/rx)**2+((y+.5-cy)/ry)**2<=1)pixels[y*size.width+x]=erase?0:1;
 }
 return encodeMask(pixels,size.width,size.height);
}
export function polygonValid(points:Point[]){return points.length>=3&&Math.abs(points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a[0]*b[1]-b[0]*a[1];},0))>0;}
export function frameMask(a:Annotation,frame:number):RleMask|undefined {
 if(a.tool!=='brush')return undefined;
 const g=a.geometry as RleMask&{frames?: (RleMask&{frame_index:number})[]};
 return frame===a.key_frame_index?g:g.frames?.find(f=>f.frame_index===frame);
}
export function updateMask(a:Annotation,frame:number,mask:RleMask):Geometry {
 const g=a.geometry as RleMask&{frames?: (RleMask&{frame_index:number})[]};
 return frame===a.key_frame_index?{...mask,frames:g.frames??[]}:{...g,frames:[...(g.frames??[]).filter(f=>f.frame_index!==frame),{...mask,frame_index:frame}].sort((x,y)=>x.frame_index-y.frame_index)};
}
export function measurement(a:Point,b:Point,size:FrameGeometry):number|undefined {
 return size.row_spacing&&size.column_spacing?Math.hypot((a[0]-b[0])*size.column_spacing,(a[1]-b[1])*size.row_spacing):undefined;
}
