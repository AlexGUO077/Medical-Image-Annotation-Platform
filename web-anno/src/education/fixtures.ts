import type { EducationWorkbench } from './types';
/** Synthetic API mock, defined before student page implementation. No reference data in workbench. */
export const educationWorkbenchFixture: EducationWorkbench = {
  attempt: { id:'30000000-0000-4000-8000-000000000001', state:'in_progress', version:0,
    answer:{body_part_id:null,normal:false,findings:'',impression:'',objects:[]},submitted_at:null },
  item: { id:'40000000-0000-4000-8000-000000000001', case_id:'50000000-0000-4000-8000-000000000001', ordinal:1 },
  task:{title:'合成影像练习',instructions:'独立阅片并完成报告',status:'published'},
  series:[{id:'60000000-0000-4000-8000-000000000001',series_uid:'1.2.826.0.1',modality:'CT',frame_count:3,default_window:{center:40,width:400}}],
  parts:[{id:'11000000-0000-4000-8000-000000000001',name:'合成示例部位'}], signs:[],
};
