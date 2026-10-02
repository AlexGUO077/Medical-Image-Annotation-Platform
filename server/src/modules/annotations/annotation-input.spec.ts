import { describe, expect, it } from 'vitest';
import { parseAnnotations } from './annotation-input';
const id = '10000000-0000-4000-8000-000000000001';
const item = { id, series_id:id, tool:'box', geometry:{x:1,y:2,w:3,h:4}, frame_start:0,frame_end:2,key_frame_index:1,
  part_id:id,sign_tag_ids:[id],confidence:'typical',report_sent_ids:[-1] };
const parse = (changes: Record<string,unknown> = {}) => parseAnnotations({expected_version:0,annotations:[{...item,...changes}]});
describe('annotation payload', () => {
  it('normalizes the public confidence and keeps explicit report-not-mentioned separate from an empty draft', () => {
    expect(parse().annotations[0]?.confidence).toBe('典型');
    expect(parse({part_id:null,confidence:null,sign_tag_ids:[]}).annotations[0]).toMatchObject({part_id:null,confidence:null,sign_tag_ids:[]});
    expect(parse().annotations[0]?.report_sent_ids).toEqual([-1]);
    expect(parse({report_sent_ids:[]}).annotations[0]?.report_sent_ids).toEqual([]);
    expect(parseAnnotations({expected_version:1,annotations:[]})).toEqual({expected_version:1,annotations:[]});
  });
  it.each([{report_sent_ids:[-1,0]},{report_sent_ids:[0,0]},{report_sent_ids:[-2]},{report_sent_ids:['0']},
    {key_frame_index:3},{frame_start:2,frame_end:1},{frame_start:0.5},{frame_end:2147483648},
    {sign_tag_ids:null},{sign_tag_ids:[id,id]},{confidence:'other'},{is_gold:true},{version:8},{created_by:id},
    {geometry:{x:0,y:0,w:0,h:2}},{geometry:{x:-1,y:0,w:2,h:2}},{geometry:{x:NaN,y:0,w:2,h:2}},
    {geometry:{x:1,y:2,w:3,h:4,type:'point'}}, {tool:'polygon',geometry:{points:[[0,0],[1,1]]}},
  ])('rejects invalid fields %j', changes => { expect(() => parse(changes)).toThrow(); });
  it('rejects duplicate object IDs and invalid version headers', () => {
    expect(() => parseAnnotations({expected_version:0,annotations:[item,item]})).toThrow('重复');
    expect(() => parseAnnotations({expected_version:-1,annotations:[]})).toThrow();
    expect(() => parseAnnotations({annotations:[]})).toThrow();
  });
  it('validates brush masks and unique per-frame contours without decoding large buffers', () => {
    const valid = {tool:'brush',geometry:{width:2,height:2,rle:[0,4],frames:[{frame_index:2,width:2,height:2,rle:[1,2,1]}]}};
    expect(parse(valid).annotations[0]?.geometry).toEqual(valid.geometry);
    for (const geometry of [
      {width:2,height:2,rle:[5]}, {width:2,height:2,rle:[1,0,3]}, {width:2,height:2,rle:[3]},
      {...valid.geometry,frames:[{frame_index:1,width:2,height:2,rle:[4]}]},
      {...valid.geometry,frames:[{frame_index:3,width:2,height:2,rle:[4]}]},
      {...valid.geometry,frames:[{frame_index:0,width:4,height:1,rle:[4]}]},
    ]) expect(() => parse({tool:'brush',geometry})).toThrow();
  });
});
