import { expect,it } from 'vitest';
import { brushStroke,measurement,polygonValid,frameMask,updateMask } from './drawing';
import { decodeMaskInto } from './rle';
import type { Annotation } from './types';
const size={width:20,height:20,row_spacing:2,column_spacing:1};
it('uses anisotropic millimetre calibration and erases only within the stroke',()=>{
 const mask=brushStroke(undefined,size,[10,10],[10,10],8,false),pixels=decodeMaskInto(mask,new Uint8Array(400));
 expect(pixels[10*20+13]).toBe(1);expect(pixels[13*20+10]).toBe(0);
 const erased=decodeMaskInto(brushStroke(mask,size,[10,10],[10,10],3,true),new Uint8Array(400));expect(erased[10*20+10]).toBe(0);expect(erased[10*20+13]).toBe(1);
 expect(measurement([0,0],[3,4],size)).toBe(Math.sqrt(73));
});
it('refuses uncalibrated brush and returns no invented millimetre measurement',()=>{
 const unknown={...size,row_spacing:null};expect(()=>brushStroke(undefined,unknown,[1,1],[2,2],5,false)).toThrow('像素间距');expect(measurement([0,0],[1,1],unknown)).toBeUndefined();
});
it('copies separate frame masks without mutating the representative',()=>{
 const original={tool:'brush',key_frame_index:0,geometry:{width:2,height:2,rle:[4],frames:[]}} as unknown as Annotation;
 const copied=updateMask(original,1,{width:2,height:2,rle:[0,4]});expect(frameMask({...original,geometry:copied},0)?.rle).toEqual([4]);expect(frameMask({...original,geometry:copied},1)?.rle).toEqual([0,4]);expect(frameMask(original,1)).toBeUndefined();
});
it('does not accept a line as a closed polygon',()=>{expect(polygonValid([[0,0],[1,1],[2,2]])).toBe(false);expect(polygonValid([[0,0],[2,0],[0,2]])).toBe(true);});
