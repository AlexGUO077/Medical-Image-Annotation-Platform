import { ServiceUnavailableException } from '@nestjs/common';
export interface FrameGeometry { width:number; height:number; row_spacing:number|null; column_spacing:number|null }
/** Only dimensions and calibrated PixelSpacing leave the DICOM tag boundary. */
export function frameGeometry(tags:Record<string,unknown>,frame:number):FrameGeometry {
  const width=Number(tags.Columns),height=Number(tags.Rows);
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width>65535||height>65535)throw new ServiceUnavailableException('影像尺寸无效');
  const measures=(value:unknown):unknown=>{
    if(!value||typeof value!=='object')return undefined;
    const sequence=(value as Record<string,unknown>).PixelMeasuresSequence;
    return Array.isArray(sequence)?sequence[0]?.PixelSpacing:undefined;
  };
  const perFrame=tags.PerFrameFunctionalGroupsSequence,shared=tags.SharedFunctionalGroupsSequence;
  const raw=(Array.isArray(perFrame)?measures(perFrame[frame]):undefined)??(Array.isArray(shared)?measures(shared[0]):undefined)??tags.PixelSpacing;
  const values=typeof raw==='string'?raw.split('\\').map(Number):Array.isArray(raw)?raw.map(Number):[];
  const valid=values.length===2&&values.every(n=>Number.isFinite(n)&&n>0);
  // ImagerPixelSpacing is detector spacing, not a substitute for patient calibration.
  return {width,height,row_spacing:valid?values[0]!:null,column_spacing:valid?values[1]!:null};
}
