import { useEffect, useRef, useState } from 'react';
import { isTextInput, objectColor } from '../viewer/workspaceConfig';
import type { mountFrame } from '../viewer/cornerstone';
import type { Annotation, Geometry } from './types';
import type { RleMask } from './rle';
import { decodeMaskInto } from './rle';
import { brushStroke, clampPoint, frameMask, inside, measurement, polygonValid, updateMask, type DrawingTool, type Point } from './drawing';
type Controls=Awaited<ReturnType<typeof mountFrame>>;
interface Props {
 colorIds?:string[]; opacity?:number; controls:Controls; annotations:Annotation[]; comparison?:Annotation[]; frame:number; selected?:string; hidden:Set<string>; locked:Set<string>;
 tool:DrawingTool; diameter:number; erase:boolean; freehand:boolean; disabled:boolean; navigation?:boolean; isActive?():boolean;
 onSelect(id:string):void; onDelete?(id:string):void; onCreate(tool:Annotation['tool'],geometry:Geometry):void; onChange(id:string,geometry:Geometry):void;
}
function vertices(a:Annotation):Point[]{
 const g=a.geometry;
 if(a.tool==='point')return [[(g as {x:number}).x,(g as {y:number}).y]];
 if(a.tool==='polygon')return (g as {points:Point[]}).points;
 if(a.tool==='box'){const b=g as {x:number;y:number;w:number;h:number};return [[b.x,b.y],[b.x+b.w/2,b.y],[b.x+b.w,b.y],[b.x+b.w,b.y+b.h/2],[b.x+b.w,b.y+b.h],[b.x+b.w/2,b.y+b.h],[b.x,b.y+b.h],[b.x,b.y+b.h/2]];}
 return [];
}
export function AnnotationLayer(p:Props){
 const canvas=useRef<HTMLCanvasElement>(null),[tick,redraw]=useState(0),[polygon,setPolygon]=useState<Point[]>([]),[cursor,setCursor]=useState<Point>();
 const gesture=useRef<{start:Point;last:Point;geometry?:Geometry;id?:string;handle?:number;original?:Annotation;path?:Point[]}>();
 const [renderError,setRenderError]=useState<string>();
 const [polygonError,setPolygonError]=useState<string>();
 const [menu,setMenu]=useState<{id:string;x:number;y:number}>();
 const menuElement=useRef<HTMLDivElement>(null);
 const [measure,setMeasure]=useState<[Point,Point]>();
 const visible=p.annotations.filter(a=>!p.hidden.has(a.id)&&p.frame>=a.frame_start&&p.frame<=a.frame_end);
 useEffect(()=>p.controls.subscribe(()=>redraw(n=>n+1)),[p.controls]);
 useEffect(()=>{gesture.current=undefined;setPolygon([]);setCursor(undefined);setMeasure(undefined);setMenu(undefined);},[p.frame,p.controls,p.disabled]);
 useEffect(()=>{
  // Selecting a handle switches tools in the same pointer gesture; keep that drag alive.
  if(gesture.current&&gesture.current.id===p.selected&&p.tool==='select')return;
  gesture.current=undefined;setPolygon([]);setCursor(undefined);setMeasure(undefined);setPolygonError(undefined);
 },[p.tool,p.selected]);
 useEffect(()=>{
  if(!menu)return;
  menuElement.current?.focus();
  const close=(e:PointerEvent)=>{if(!menuElement.current?.contains(e.target as Node))setMenu(undefined);};
  window.addEventListener('pointerdown',close,true);return()=>window.removeEventListener('pointerdown',close,true);
 },[menu]);
 const finishPolygon=()=>{
  if(p.disabled||p.isActive?.()===false)return;
  if(!polygonValid(polygon)){setPolygonError('至少需要三个不在同一直线上的顶点');return;}
  p.onCreate('polygon',{points:polygon});setPolygon([]);setCursor(undefined);setPolygonError(undefined);gesture.current=undefined;
 };
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{
   if(isTextInput(e.target))return;
   if(e.key==='Escape'){gesture.current=undefined;setPolygon([]);setCursor(undefined);setMenu(undefined);setPolygonError(undefined);redraw(n=>n+1);}
   if(p.tool==='polygon'&&polygon.length&&e.key==='Enter'){e.preventDefault();finishPolygon();}
   if(p.tool==='polygon'&&e.key==='Backspace'){e.preventDefault();setPolygon(old=>old.slice(0,-1));}
  };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 });
 useEffect(()=>{
  // React development refresh can rerun a renderer effect while retaining overlay state.
  if(p.isActive?.()===false)return;
  const el=canvas.current;if(!el)return;const width=el.clientWidth,height=el.clientHeight,dpr=window.devicePixelRatio||1;el.width=width*dpr;el.height=height*dpr;
  const ctx=el.getContext('2d');if(!ctx)return;ctx.scale(dpr,dpr);let invalidMask=false;
  const project=(point:Point)=>p.controls.toCanvas(...point);
  const path=(points:Point[],close=false)=>{if(!points.length)return;ctx.beginPath();points.forEach((point,i)=>{const q=project(point);if(i)ctx.lineTo(...q);else ctx.moveTo(...q);});if(close)ctx.closePath();ctx.stroke();};
  const draw=(a:Annotation,color:string)=>{
   let labelPoint=vertices(a)[0];
   ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=a.id===p.selected?3:2;ctx.shadowColor='#000';ctx.shadowBlur=2;
   if(a.tool==='brush'){
    const mask=frameMask(a,p.frame);if(!mask)return;if(mask.width!==p.controls.geometry.width||mask.height!==p.controls.geometry.height){invalidMask=true;return;}const pixels=decodeMaskInto(mask,new Uint8Array(p.controls.geometry.width*p.controls.geometry.height));
    const first=pixels.findIndex(value=>value>0);if(first>=0)labelPoint=[first%mask.width,Math.floor(first/mask.width)];
    const off=document.createElement('canvas');off.width=mask.width;off.height=mask.height;const c=off.getContext('2d')!;const image=c.createImageData(mask.width,mask.height);
    pixels.forEach((value,i)=>{if(value){image.data[i*4]=parseInt(color.slice(1,3),16);image.data[i*4+1]=parseInt(color.slice(3,5),16);image.data[i*4+2]=parseInt(color.slice(5,7),16);image.data[i*4+3]=85;}});c.putImageData(image,0,0);
    const o=project([0,0]),x=project([1,0]),y=project([0,1]);ctx.save();ctx.transform(x[0]-o[0],x[1]-o[1],y[0]-o[0],y[1]-o[1],o[0],o[1]);ctx.drawImage(off,0,0);ctx.restore();
   }else if(a.tool==='point'){const q=project(vertices(a)[0]);ctx.beginPath();ctx.arc(q[0],q[1],5,0,Math.PI*2);ctx.stroke();}
   else path(vertices(a),true);
   const number=ids.indexOf(a.id)+1;
   if(labelPoint&&number>0){const q=project(labelPoint);ctx.save();ctx.shadowBlur=0;ctx.font='12px sans-serif';ctx.fillStyle='#08101de6';ctx.fillRect(q[0]-2,q[1]-20,ctx.measureText(String(number)).width+10,17);ctx.fillStyle=color;ctx.fillText(String(number),q[0]+3,q[1]-7);ctx.restore();}
   if(a.id===p.selected&&!p.locked.has(a.id)){ctx.fillStyle='#fff';for(const point of vertices(a)){const q=project(point);ctx.fillRect(q[0]-3,q[1]-3,6,6);}}
  };
  const ids=p.colorIds??[...new Set([...p.annotations,...(p.comparison??[])].map(a=>a.id))];
  const color=(id:string)=>objectColor(ids.indexOf(id));
  ctx.save();ctx.globalAlpha=0.45;ctx.setLineDash([6,4]);
  (p.comparison??[]).filter(a=>!p.hidden.has(a.id)&&p.frame>=a.frame_start&&p.frame<=a.frame_end).forEach(a=>draw(a,color(a.id)));
  ctx.restore();
  visible.forEach(a=>draw(gesture.current?.id===a.id&&gesture.current.geometry?{...a,geometry:gesture.current.geometry}:a,color(a.id)));
  const g=gesture.current;
  if(g?.geometry&&!g.id&&['point','box','brush','polygon'].includes(p.tool))draw({id:'preview',tool:p.tool as Annotation['tool'],geometry:g.geometry,key_frame_index:p.frame} as Annotation,'#FFFFFF');
  ctx.strokeStyle='#fff';ctx.lineWidth=2;path(polygon);if(polygon.length&&cursor)path([polygon.at(-1)!,cursor]);
  if(polygon.length){const first=project(polygon[0]);ctx.beginPath();ctx.arc(first[0],first[1],polygon.length>=3?7:4,0,Math.PI*2);ctx.strokeStyle='#5ACCE6';ctx.stroke();}
  if(measure){path(measure);const mm=measurement(...measure,p.controls.geometry);const q=project(measure[1]);ctx.fillStyle='#fff';ctx.font='14px sans-serif';ctx.fillText(mm===undefined?'未标定':`${mm.toFixed(2)} mm`,q[0]+8,q[1]-8);}
  if(cursor&&p.tool==='brush'&&p.controls.geometry.row_spacing&&p.controls.geometry.column_spacing){const q=project(cursor),x=project([cursor[0]+p.diameter/2/p.controls.geometry.column_spacing,cursor[1]]),y=project([cursor[0],cursor[1]+p.diameter/2/p.controls.geometry.row_spacing]);ctx.strokeStyle=p.erase?'#ff8787':'#fff';ctx.beginPath();ctx.ellipse(q[0],q[1],Math.hypot(x[0]-q[0],x[1]-q[1]),Math.hypot(y[0]-q[0],y[1]-q[1]),0,0,Math.PI*2);ctx.stroke();}
  setRenderError(invalidMask?'掩膜尺寸与当前影像不符，该轮廓无法显示':undefined);
 },[p,polygon,cursor,tick,measure,visible]);
 const point=(e:React.MouseEvent)=>{const rect=e.currentTarget.getBoundingClientRect();return p.controls.toImage(e.clientX-rect.left,e.clientY-rect.top);};
 const hit=(a:Annotation,point:Point)=>{
  if(a.tool==='brush'){const mask=frameMask(a,p.frame);if(!mask||mask.width!==p.controls.geometry.width||mask.height!==p.controls.geometry.height)return false;const x=Math.floor(point[0]),y=Math.floor(point[1]);return x>=0&&y>=0&&x<mask.width&&y<mask.height&&!!decodeMaskInto(mask,new Uint8Array(p.controls.geometry.width*p.controls.geometry.height))[y*mask.width+x];}
  const points=vertices(a).map(v=>p.controls.toCanvas(...v)),q=p.controls.toCanvas(...point);
  return points.some((v,i)=>{const next=points[(i+1)%points.length],dx=next[0]-v[0],dy=next[1]-v[1],length=dx*dx+dy*dy;
   const t=length?Math.max(0,Math.min(1,((q[0]-v[0])*dx+(q[1]-v[1])*dy)/length)):0;
   return Math.hypot(q[0]-v[0]-t*dx,q[1]-v[1]-t*dy)<9;
  });
 };
 const targetAt=(q:Point)=>{const selected=visible.find(a=>a.id===p.selected);return selected&&hit(selected,q)?selected:[...visible].reverse().find(a=>hit(a,q));};
 return <><canvas ref={canvas} aria-label="标注绘图层" tabIndex={0} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none',opacity:p.opacity??1}}
  onContextMenu={e=>{
   e.preventDefault();if(p.isActive?.()===false)return;const a=targetAt(point(e));if(!a||!p.onDelete)return;
   e.stopPropagation();p.onSelect(a.id);gesture.current=undefined;
   const rect=e.currentTarget.getBoundingClientRect();setMenu({id:a.id,x:Math.max(0,Math.min(e.clientX-rect.left,rect.width-160)),y:Math.max(0,Math.min(e.clientY-rect.top,rect.height-90))});
  }} onPointerDown={e=>{
   if(p.isActive?.()===false)return;
   const q=point(e),a=targetAt(q);
   if(e.button===2||e.ctrlKey){if(a)e.stopPropagation();return;}
   if(e.button!==0)return;
   // Finish an in-progress polygon before considering existing contours beneath it.
   const drawingPolygon=p.tool==='polygon'&&polygon.length>0;
   const painting=p.tool==='brush'&&a?.id===p.selected&&a?.tool==='brush'&&!p.navigation&&!p.disabled;
   if(a&&!drawingPolygon&&!painting){
    e.stopPropagation();e.preventDefault();canvas.current?.focus();p.onSelect(a.id);if(p.disabled||p.locked.has(a.id))return;
    canvas.current?.setPointerCapture(e.pointerId);
    const c=p.controls.toCanvas(...q);const handle=vertices(a).findIndex(v=>{const d=p.controls.toCanvas(...v);return Math.hypot(c[0]-d[0],c[1]-d[1])<10;});
    if(a.tool!=='brush')gesture.current={start:q,last:q,id:a.id,handle,original:a};return;
   }
   if(p.disabled||p.navigation)return;
   if((p.tool==='brush'||p.tool==='measure')&&(!p.controls.geometry.row_spacing||!p.controls.geometry.column_spacing))return;if(p.tool!=='pan'&&!inside(q,p.controls.geometry))return;
   e.stopPropagation();e.preventDefault();canvas.current?.focus();canvas.current?.setPointerCapture(e.pointerId);
   if(p.tool==='polygon'&&!p.freehand){
    const c=p.controls.toCanvas(...q),first=polygon.length?p.controls.toCanvas(...polygon[0]):undefined;
    if(polygon.length>=3&&first&&Math.hypot(first[0]-c[0],first[1]-c[1])<=10){finishPolygon();return;}
    setPolygonError(undefined);setPolygon(old=>old.length&&Math.hypot(old.at(-1)![0]-q[0],old.at(-1)![1]-q[1])<1e-6?old:[...old,q]);return;
   }
   if(p.tool==='select')return;
   if(p.tool==='brush'){
    const a=visible.find(a=>a.id===p.selected&&a.tool==='brush');if(a&&p.locked.has(a.id))return;
    if(p.erase&&!a)return;const mask=brushStroke(a?frameMask(a,p.frame):undefined,p.controls.geometry,q,q,p.diameter,p.erase);
    gesture.current={start:q,last:q,id:a?.id,original:a,geometry:a?updateMask(a,p.frame,mask):mask};
   }else gesture.current={start:q,last:q,path:p.tool==='polygon'?[q]:undefined};
   if(p.tool==='point')gesture.current.geometry={x:q[0],y:q[1]};redraw(n=>n+1);
  }} onPointerMove={e=>{
   if(p.isActive?.()===false)return;
   if((p.tool==='brush'||p.tool==='measure')&&(!p.controls.geometry.row_spacing||!p.controls.geometry.column_spacing)){gesture.current=undefined;return;}
   const q=clampPoint(point(e),p.controls.geometry);setCursor(q);const g=gesture.current;if(!g||p.disabled)return;e.stopPropagation();
   if(p.tool==='pan'){p.controls.pan(e.movementX,e.movementY);return;}
   if(p.tool==='measure'){setMeasure([g.start,q]);return;}
   if(p.tool==='brush'){
    const a=g.original;const current=a?frameMask({...a,geometry:g.geometry!},p.frame):g.geometry as RleMask;
    const mask=brushStroke(current,p.controls.geometry,g.last,q,p.diameter,p.erase);g.geometry=a?updateMask(a,p.frame,mask):mask;
   }else if(p.tool==='box')g.geometry={x:Math.min(q[0],g.start[0]),y:Math.min(q[1],g.start[1]),w:Math.abs(q[0]-g.start[0]),h:Math.abs(q[1]-g.start[1])};
   else if(p.tool==='point'||(p.tool==='select'&&g.original?.tool==='point'))g.geometry={x:q[0],y:q[1]};
   else if(p.tool==='polygon'&&g.path){g.path.push(q);g.geometry={points:g.path};}
   else if(p.tool==='select'&&g.original){
    const a=g.original;
    if(g.handle===-1&&a.tool!=='point'){
     const points=vertices(a),xs=points.map(v=>v[0]),ys=points.map(v=>v[1]);
     const dx=Math.max(-Math.min(...xs),Math.min(p.controls.geometry.width-1e-6-Math.max(...xs),q[0]-g.start[0]));
     const dy=Math.max(-Math.min(...ys),Math.min(p.controls.geometry.height-1e-6-Math.max(...ys),q[1]-g.start[1]));
     if(a.tool==='polygon')g.geometry={points:points.map(v=>[v[0]+dx,v[1]+dy])};
     else if(a.tool==='box'){const b=a.geometry as {x:number;y:number;w:number;h:number};g.geometry={...b,x:b.x+dx,y:b.y+dy};}
    }else if(a.tool==='polygon'){const points=vertices(a).map(v=>[...v] as Point);points[g.handle!]=q;g.geometry={points};}
    else if(a.tool==='box'){const b=a.geometry as {x:number;y:number;w:number;h:number};let left=b.x,right=b.x+b.w,top=b.y,bottom=b.y+b.h;const h=g.handle!;if([0,6,7].includes(h))left=q[0];if([2,3,4].includes(h))right=q[0];if([0,1,2].includes(h))top=q[1];if([4,5,6].includes(h))bottom=q[1];g.geometry={x:Math.min(left,right),y:Math.min(top,bottom),w:Math.abs(right-left),h:Math.abs(bottom-top)};}
   }
   g.last=q;redraw(n=>n+1);
  }} onPointerUp={e=>{
   const g=gesture.current;gesture.current=undefined;if(!g?.geometry)return;
   e.stopPropagation();redraw(n=>n+1);if(p.disabled||p.isActive?.()===false||(g.id&&p.locked.has(g.id)))return;
   const tool=g.original?.tool??p.tool;
   if(tool==='box'&&(!(g.geometry as {w:number}).w||!(g.geometry as {h:number}).h))return;
   if(tool==='polygon'&&!polygonValid((g.geometry as {points:Point[]}).points))return;
   if(g.id)p.onChange(g.id,g.geometry);else if(['point','box','polygon','brush'].includes(tool))p.onCreate(tool as Annotation['tool'],g.geometry);
  }} onPointerCancel={()=>{gesture.current=undefined;redraw(n=>n+1);}} onPointerLeave={()=>setCursor(undefined)} onDoubleClick={e=>{if(p.tool==='polygon'&&!p.freehand){e.stopPropagation();finishPolygon();}}}/>
  {p.tool==='polygon'&&!p.disabled&&!p.navigation&&<div className="annotation-drawing-hint" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
   <span role="status">{polygonError??(p.freehand?'按住绘制，松开闭合 · Esc 取消':`已标 ${polygon.length} 个顶点 · 点击起点 / 双击 / Enter 完成 · Esc 取消`)}</span>
   {!p.freehand&&<div><button type="button" disabled={polygon.length<3} onClick={finishPolygon}>完成多边形</button><button type="button" disabled={!polygon.length} onClick={()=>setPolygon(old=>old.slice(0,-1))}>撤回一点</button><button type="button" onClick={()=>{setPolygon([]);setCursor(undefined);setPolygonError(undefined);}}>取消绘制</button></div>}
  </div>}
  {menu&&<div className="annotation-context-menu" ref={menuElement} role="menu" aria-label="标注对象操作" tabIndex={-1} style={{left:menu.x,top:menu.y}} onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){setMenu(undefined);canvas.current?.focus();}}}>
   <span>对象 {(p.colorIds??p.annotations.map(a=>a.id)).indexOf(menu.id)+1}{p.locked.has(menu.id)?' · 已锁定':p.disabled?' · 只读':''}</span>
   <button type="button" role="menuitem" disabled={p.disabled||p.locked.has(menu.id)} onClick={()=>{p.onDelete?.(menu.id);setMenu(undefined);canvas.current?.focus();}}>删除对象</button>
  </div>}
  {renderError&&<div role="alert" style={{position:'absolute',top:0,color:'#fff',background:'#a8071a'}}>{renderError}</div>}</>;
}
