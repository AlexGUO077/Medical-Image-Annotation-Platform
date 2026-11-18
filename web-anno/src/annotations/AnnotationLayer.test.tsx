import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AnnotationLayer } from './AnnotationLayer';
import { brushStroke, type DrawingTool } from './drawing';
import type { Annotation } from './types';
import { annotationControls, mockAnnotationCanvas } from '../test/canvas';
import { annotations } from '../../../test/fixtures/synthetic/viewer-interactions';

const point:Annotation={...annotations[0],geometry:{x:50,y:50}};
const box:Annotation={...point,id:'box',tool:'box',geometry:{x:100,y:100,w:100,h:100}};
const polygon:Annotation={...point,id:'polygon',tool:'polygon',geometry:{points:[[100,100],[200,100],[150,200]]}};
const change=vi.fn(),create=vi.fn(),remove=vi.fn(),select=vi.fn();
const controls=annotationControls();
type Props=Parameters<typeof AnnotationLayer>[0];
function show(extra:Partial<Props>={}) {
  function Host() {
    const [selected,setSelected]=useState(extra.selected),[tool,setTool]=useState<DrawingTool>(extra.tool??'pan');
    return <AnnotationLayer controls={controls} annotations={[point]} hidden={new Set()} locked={new Set()} frame={0} diameter={5} erase={false} freehand={false} disabled={false} {...extra}
      selected={selected} tool={tool} navigation={tool==='pan'||tool==='zoom'}
      onSelect={id=>{select(id);setSelected(id);setTool('select');}}
      onCreate={(kind,geometry)=>{create(kind,geometry);setTool('select');}}
      onChange={change} onDelete={remove}/>;
  }
  render(<Host/>);return screen.getByLabelText('标注绘图层');
}
function down(canvas:HTMLElement,x:number,y:number) { fireEvent.pointerDown(canvas,{button:0,clientX:x,clientY:y}); }
function click(canvas:HTMLElement,x:number,y:number) { down(canvas,x,y);fireEvent.pointerUp(canvas,{button:0,clientX:x,clientY:y}); }
function drag(canvas:HTMLElement,from:number[],to:number[]) { down(canvas,from[0],from[1]);fireEvent.pointerMove(canvas,{clientX:to[0],clientY:to[1]});fireEvent.pointerUp(canvas,{clientX:to[0],clientY:to[1]}); }
beforeEach(()=>{vi.clearAllMocks();mockAnnotationCanvas();});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

it('selects and moves a point on its first drag from navigation mode',()=>{
  drag(show(),[50,50],[70,80]);
  expect(select).toHaveBeenCalledWith(point.id);
  expect(change).toHaveBeenCalledWith(point.id,{x:70,y:80});
});
it.each([
  [box,[100,100],[80,90],{x:80,y:90,w:120,h:110}],
  [polygon,[100,100],[80,90],{points:[[80,90],[200,100],[150,200]]}],
])('edits the first selected vertex without cancelling the pointer gesture',(item,from,to,expected)=>{
  drag(show({annotations:[item]}),from,to);expect(change).toHaveBeenCalledWith(item.id,expected);
});
it.each([
  [box,[125,100],[145,120],{x:120,y:120,w:100,h:100}],
  [polygon,[150,100],[170,120],{points:[[120,120],[220,120],[170,220]]}],
])('moves the entire contour by dragging an edge away from its handles',(item,from,to,expected)=>{
  drag(show({annotations:[item]}),from,to);expect(change).toHaveBeenCalledWith(item.id,expected);
});
it('starts a separate brush lesion on an existing mask when explicitly adding',()=>{
  const brush:Annotation={...point,tool:'brush',geometry:brushStroke(undefined,controls.geometry,[50,50],[70,50],10,false)};
  const canvas=show({annotations:[brush],tool:'brush',createNew:true});
  drag(canvas,[60,50],[85,65]);
  expect(create).toHaveBeenCalledExactlyOnceWith('brush',expect.any(Object));
  expect(change).not.toHaveBeenCalled();expect(select).not.toHaveBeenCalled();
});
it('does not mistake the empty interior of a polygon for its contour',()=>{
  click(show({annotations:[polygon]}),150,140);expect(select).not.toHaveBeenCalled();
});
it('moves just the hit point in a group and leaves the space between points unselected',()=>{
  const group={...point,frame_end:2,geometry:{x:50,y:50,additional_points:[{frame_index:2,x:90,y:90},{frame_index:0,x:130,y:50}]}};
  const canvas=show({annotations:[group]});
  click(canvas,90,50);click(canvas,90,90);expect(select).not.toHaveBeenCalled();
  drag(canvas,[130,50],[135,60]);
  expect(change).toHaveBeenCalledWith(group.id,{x:50,y:50,additional_points:[{frame_index:2,x:90,y:90},{frame_index:0,x:135,y:60}]});
});
it('adjusts the nearest mark when two point handles overlap',()=>{
  const group={...point,geometry:{x:50,y:50,additional_points:[{frame_index:0,x:54,y:51}]}};
  drag(show({annotations:[group]}),[54,51],[62,62]);
  expect(change).toHaveBeenCalledWith(group.id,{x:50,y:50,additional_points:[{frame_index:0,x:62,y:62}]});
});
it('selects painted mask pixels and offers object deletion',()=>{
  const brush:Annotation={...point,tool:'brush',geometry:brushStroke(undefined,controls.geometry,[50,50],[70,50],10,false)};
  const canvas=show({annotations:[brush]});click(canvas,60,50);expect(select).toHaveBeenCalledWith(point.id);
  fireEvent.contextMenu(canvas,{clientX:60,clientY:50});
  fireEvent.click(screen.getByRole('menuitem',{name:'删除对象'}));expect(remove).toHaveBeenCalledWith(point.id);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});
it.each([{locked:new Set([point.id])},{disabled:true}])('allows selection but prevents editing and deletion when protected',extra=>{
  const canvas=show(extra);drag(canvas,[50,50],[70,80]);
  expect(select).toHaveBeenCalledWith(point.id);expect(change).not.toHaveBeenCalled();
  fireEvent.contextMenu(canvas,{clientX:50,clientY:50});
  expect(screen.getByRole('menuitem',{name:'删除对象'})).toBeDisabled();
  fireEvent.click(screen.getByRole('menuitem',{name:'删除对象'}));expect(remove).not.toHaveBeenCalled();
});
it('opens no deletion menu on blank image pixels and closes the menu with Escape',()=>{
  const canvas=show();fireEvent.contextMenu(canvas,{clientX:300,clientY:300});expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  fireEvent.contextMenu(canvas,{clientX:50,clientY:50});fireEvent.keyDown(screen.getByRole('menu'),{key:'Escape'});
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  fireEvent.contextMenu(canvas,{clientX:50,clientY:50});click(canvas,50,50);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});
it.each(['start','double','enter','button'])('finishes a polygon exactly once via %s and leaves drawing mode',method=>{
  const canvas=show({annotations:[],tool:'polygon'});
  click(canvas,100,100);click(canvas,200,100);click(canvas,150,200);
  if(method==='start')click(canvas,102,102);
  if(method==='double') { click(canvas,150,200);fireEvent.doubleClick(canvas,{clientX:150,clientY:200}); }
  if(method==='enter')fireEvent.keyDown(canvas,{key:'Enter'});
  if(method==='button')fireEvent.click(screen.getByRole('button',{name:'完成多边形'}));
  expect(create).toHaveBeenCalledExactlyOnceWith('polygon',{points:[[100,100],[200,100],[150,200]]});
  expect(screen.queryByRole('button',{name:'完成多边形'})).not.toBeInTheDocument();
  fireEvent.pointerMove(canvas,{clientX:300,clientY:300});expect(create).toHaveBeenCalledTimes(1);
});
it('supports undoing a vertex, cancellation, and rejects degenerate polygons',()=>{
  const canvas=show({annotations:[],tool:'polygon'});
  click(canvas,100,100);click(canvas,200,100);expect(screen.getByRole('button',{name:'完成多边形'})).toBeDisabled();
  fireEvent.keyDown(canvas,{key:'Backspace'});expect(screen.getByRole('status')).toHaveTextContent('已标 1 个顶点');
  click(canvas,200,100);click(canvas,300,100);fireEvent.keyDown(canvas,{key:'Enter'});
  expect(create).not.toHaveBeenCalled();expect(screen.getByRole('status')).toHaveTextContent('不在同一直线');
  fireEvent.keyDown(canvas,{key:'Escape'});expect(screen.getByRole('status')).toHaveTextContent('已标 0 个顶点');
});

it('does not draw or accept pointer events through a renderer released during development refresh',()=>{
  const released=annotationControls();let live=true;
  const props={controls:released,annotations:[point],hidden:new Set<string>(),locked:new Set<string>(),frame:0,diameter:5,erase:false,freehand:false,disabled:false,tool:'select' as const,onSelect:select,onCreate:create,onChange:change,isActive:()=>live};
  const view=render(<AnnotationLayer {...props}/>);
  const calls=released.toCanvas.mock.calls.length;expect(calls).toBeGreaterThan(0);
  live=false;released.dispose();view.rerender(<AnnotationLayer {...props} selected={point.id}/>);
  const canvas=screen.getByLabelText('标注绘图层');drag(canvas,[50,50],[70,80]);fireEvent.contextMenu(canvas,{clientX:50,clientY:50});
  expect(released.toCanvas).toHaveBeenCalledTimes(calls);expect(released.toImage).not.toHaveBeenCalled();expect(change).not.toHaveBeenCalled();
});
