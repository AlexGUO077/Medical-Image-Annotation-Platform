import { cache, Enums, imageLoader, init, metaData, RenderingEngine, utilities, type Types } from '@cornerstonejs/core';
import { viewerApi, type FrameWindow, type Series, type FrameGeometry } from './api';

const pending = new Map<string, () => Promise<Types.IImage>>();
const metadata = new Map<string, Record<string, unknown>>();
let initialized = false;

/** A single watermarked display frame in RAM; never a DICOM loader or a calibrated measurement image. */
export async function mountFrame(element: HTMLDivElement, token: string, caseId: string, series: Series, index: number, window: FrameWindow | null, signal: AbortSignal,libraryVersion?:number) {
  if (!initialized) {
    init();
    metaData.addProvider((type, imageId: string) => metadata.get(imageId)?.[type]);
    imageLoader.registerImageLoader('miap', imageId => ({ promise: pending.get(imageId)?.() ?? Promise.reject(new Error('帧已失效')) }));
    initialized = true;
  }
  const id = crypto.randomUUID(), imageId = `miap:${id}`, engine = new RenderingEngine(id);
  let disposed = false;
  let geometry: FrameGeometry;
  let resize: ResizeObserver | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener('abort', dispose);
    resize?.disconnect();
    pending.delete(imageId);
    metadata.delete(imageId);
    engine.destroy();
    if (cache.getImageLoadObject(imageId)) cache.removeImageLoadObject(imageId);
    element.replaceChildren();
  };
  signal.addEventListener('abort', dispose, { once: true });
  pending.set(imageId, async () => {
    const receipt = libraryVersion===undefined?await viewerApi.frame(token,caseId,series,index,window,signal):await viewerApi.frame(token,caseId,series,index,window,signal,libraryVersion);
    const {blob} = receipt;geometry=receipt.geometry;
    const bitmap = await createImageBitmap(blob);
    try {
      if (disposed || signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if(bitmap.width!==geometry.width||bitmap.height!==geometry.height)throw new Error('帧尺寸与 DICOM 坐标不一致');
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器无法解码影像');
      context.drawImage(bitmap, 0, 0);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      // Cornerstone's GPU color texture expects packed RGB; passing RGBA corrupts row stride.
      const pixels = new Uint8Array(canvas.width * canvas.height * 3);
      for (let source = 0, target = 0; source < rgba.length; source += 4) {
        pixels[target++] = rgba[source]; pixels[target++] = rgba[source + 1]; pixels[target++] = rgba[source + 2];
      }
      // Metadata describes the returned PNG, never patient geometry or original DICOM intensities.
      metadata.set(imageId, {
        imagePlaneModule: { rows: canvas.height, columns: canvas.width, usingDefaultValues: true, rowCosines: [1, 0, 0], columnCosines: [0, 1, 0], imagePositionPatient: [0, 0, 0], imageOrientationPatient: [1, 0, 0, 0, 1, 0], rowPixelSpacing: geometry.row_spacing??1, columnPixelSpacing: geometry.column_spacing??1 },
        imagePixelModule: { bitsAllocated: 8, bitsStored: 8, highBit: 7, pixelRepresentation: 0, samplesPerPixel: 3, photometricInterpretation: 'RGB' },
        generalSeriesModule: { modality: 'OT' },
      });
      return {
        imageId, width: canvas.width, height: canvas.height, rows: canvas.height, columns: canvas.width,
        minPixelValue: 0, maxPixelValue: 255, slope: 1, intercept: 0, windowCenter: 128, windowWidth: 256,
        voiLUTFunction: Enums.VOILUTFunctionType.LINEAR, color: true, rgba: false, numberOfComponents: 3,
        columnPixelSpacing: geometry.column_spacing??1, rowPixelSpacing: geometry.row_spacing??1, invert: false, sizeInBytes: pixels.byteLength, dataType: 'Uint8Array',
        voxelManager: utilities.VoxelManager.createImageVoxelManager({ scalarData: pixels, width: canvas.width, height: canvas.height, numberOfComponents: 3 }),
        getPixelData: () => pixels, getCanvas: () => canvas,
      } satisfies Types.IImage;
    } finally { bitmap.close(); }
  });
  try {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    engine.enableElement({ viewportId: id, type: Enums.ViewportType.STACK, element });
    const viewport = engine.getViewport(id) as Types.IStackViewport;
    // Resolve first and cache only successful frames. In this core version the GPU
    // stack/cache convenience path leaves detached rejections on request failure.
    const image = await imageLoader.loadImage(imageId);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    cache.putImageSync(imageId, image);
    await viewport.setStack([imageId]);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    viewport.render();
    resize = new ResizeObserver(() => { if (!disposed) engine.resize(true, true); });
    resize.observe(element);
    if(libraryVersion===undefined)viewerApi.preload(token,caseId,series,index+1,window);else viewerApi.preload(token,caseId,series,index+1,window,libraryVersion);
    const toCanvas = (x:number,y:number):Types.Point2 => viewport.worldToCanvas(utilities.transformIndexToWorld(viewport.getImageData().imageData,[x-.5,y-.5,0]));
    const toImage = (x:number,y:number):[number,number] => {
      const point=utilities.transformWorldToIndexContinuous(viewport.getImageData().imageData,viewport.canvasToWorld([x,y]));
      return [point[0]+.5,point[1]+.5];
    };
    return {
      geometry: geometry!, toCanvas, toImage,
      subscribe: (listener:()=>void) => {
        element.addEventListener(Enums.Events.IMAGE_RENDERED,listener);
        return ()=>element.removeEventListener(Enums.Events.IMAGE_RENDERED,listener);
      },
      zoom: (factor: number) => { viewport.setZoom(viewport.getZoom() * factor); viewport.render(); },
      pan: (x: number, y: number) => { const old = viewport.getPan(); viewport.setPan([old[0] + x, old[1] + y]); viewport.render(); },
      reset: () => { viewport.resetCamera(); viewport.render(); },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
