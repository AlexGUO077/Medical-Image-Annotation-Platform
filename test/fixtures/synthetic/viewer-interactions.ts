// Hand-authored UI test data. Contains no patient records, real images or identifiers.
import type {Annotation} from '../../../web-anno/src/annotations/types';
import type {Workbench} from '../../../web-anno/src/viewer/api';
export const annotations:Annotation[]=[1,2].map(n=>({id:`object-${n}`,series_id:'series',tool:'point',geometry:{x:n*10,y:10},frame_start:n-1,frame_end:n-1,key_frame_index:n-1,window_preset:null,part_id:null,confidence:null,sign_tag_ids:[],report_sent_ids:[n-1]}));
export const data:Workbench={case:{id:'case',case_no:'SYN-INTERACTION',source:'synthetic',system_code:'resp',status:'标注中',clinical_text:null,age_band:null,sex:null,confirm_method:'临床综合诊断'},series:[{id:'series',series_uid:'2.25.1',modality:'CT',frame_count:3,default_window:{center:40,width:400}}],sentences:[{idx:0,text:'合成报告第一句'},{idx:1,text:'合成报告第二句'}],attachments:[]};
