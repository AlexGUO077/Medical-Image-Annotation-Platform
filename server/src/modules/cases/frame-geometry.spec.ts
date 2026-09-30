import { expect,it } from 'vitest';
import { frameGeometry } from './frame-geometry';
it('allowlists dimensions and patient pixel spacing, preferring per-frame calibration',()=>{
 const tags={Rows:'512',Columns:'256',PixelSpacing:'1\\2',PatientName:'must-not-escape',SharedFunctionalGroupsSequence:[{PixelMeasuresSequence:[{PixelSpacing:'0.5\\0.7'}]}],PerFrameFunctionalGroupsSequence:[{}, {PixelMeasuresSequence:[{PixelSpacing:'0.8\\0.9'}]}]};
 expect(frameGeometry(tags,1)).toEqual({width:256,height:512,row_spacing:.8,column_spacing:.9});
 expect(frameGeometry(tags,0)).toEqual({width:256,height:512,row_spacing:.5,column_spacing:.7});
});
it('does not invent patient calibration from detector spacing or malformed values',()=>{
 expect(frameGeometry({Rows:1,Columns:2,ImagerPixelSpacing:'1\\1'},0)).toEqual({width:2,height:1,row_spacing:null,column_spacing:null});
 expect(frameGeometry({Rows:1,Columns:2,PixelSpacing:'0\\1'},0).row_spacing).toBeNull();
});
it.each([{}, {Rows:0,Columns:2},{Rows:'NaN',Columns:2},{Rows:1,Columns:65536}])('rejects invalid DICOM dimensions',tags=>expect(()=>frameGeometry(tags,0)).toThrow('尺寸无效'));
