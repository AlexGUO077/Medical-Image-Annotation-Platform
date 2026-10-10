import { vi } from 'vitest';

/** Canvas drawing is exercised in jsdom; coordinates remain in image pixels. */
export function mockAnnotationCanvas() {
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x:0, y:0, left:0, top:0, right:640, bottom:480, width:640, height:480, toJSON:()=>({}) });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable:true, value:vi.fn() });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new Proxy({
    measureText: (text:string) => ({ width:text.length*8 }),
    createImageData: (width:number,height:number) => ({ data:new Uint8ClampedArray(width*height*4) }),
  }, { get:(target,key)=>key in target?Reflect.get(target,key):()=>{} }) as unknown as CanvasRenderingContext2D);
}
export function annotationControls() {
  let disposed=false;
  const project=(x:number,y:number):[number,number]=>{
    if(disposed)throw new Error('Cannot project through a disposed renderer');
    return [x,y];
  };
  return {
    geometry:{width:640,height:480,row_spacing:1,column_spacing:1},
    toCanvas:vi.fn(project), toImage:vi.fn(project), subscribe:()=>()=>{},
    zoom:vi.fn(), pan:vi.fn(), reset:vi.fn(), dispose:vi.fn(()=>{disposed=true;}),
  };
}
