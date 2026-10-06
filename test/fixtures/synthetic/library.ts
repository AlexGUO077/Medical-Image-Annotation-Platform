// Generated synthetic API mock only; contains no real patient, report or imaging data.
import type { LibraryData, SearchResult } from '../../../web-anno/src/library/types';
export const libraryCaseId='11111111-2222-4333-8444-555555555555';
export const libraryData:LibraryData={
 case:{id:libraryCaseId,case_no:'SYN-LIBRARY-DX',system_code:'resp',source:'synthetic',status:'已发布',clinical_text:'合成肺部测试病灶',age_band:'成人',sex:'未知',confirm_method:'临床综合诊断'},
 version:1,current_version:1,annotations:[],attachments:[],sentences:[{idx:0,text:'合成肺部结节。'}],
 disease:{id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',name:'合成疾病'},teaching_fields:{difficulty:'基础'},
 series:[{id:'22222222-3333-4444-8555-666666666666',series_uid:'2.25.12345',modality:'DX',frame_count:1,default_window:null}],
};
export const librarySearch:SearchResult={page:1,pageSize:20,total:1,items:[{id:libraryCaseId,case_no:libraryData.case.case_no,system_code:'resp',source:'synthetic',version:1,disease:libraryData.disease,signs:[{id:'33333333-4444-4555-8666-777777777777',name:'结节'}],modalities:['DX'],thumbnail:{...libraryData.series[0]!,frame_index:0}}]};
