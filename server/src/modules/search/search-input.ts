import { BadRequestException } from '@nestjs/common';
import { CASE_UUID } from '../cases/cases-clinical.service';
import { systemNames } from './published-case';
export interface SearchInput {system_code?:string;part_id?:string;disease_id?:string;sign_tag_id?:string;modality?:string;source?:string;q:string;page:number;pageSize:number}
export function parseSearch(input:Record<string,unknown>):SearchInput {
 const allowed=['system_code','part_id','disease_id','sign_tag_id','modality','source','q','page','pageSize'];
 if(Object.keys(input).some(k=>!allowed.includes(k))||Object.values(input).some(v=>typeof v!=='string'))throw new BadRequestException('检索参数无效');
 const result:SearchInput={q:'',page:1,pageSize:20};
 for(const key of ['part_id','disease_id','sign_tag_id'] as const)if(input[key]!==undefined){if(!CASE_UUID.test(input[key] as string))throw new BadRequestException('标签 ID 无效');result[key]=(input[key] as string).toLowerCase();}
 for(const key of ['system_code','modality','source'] as const)if(input[key]!==undefined)result[key]=input[key] as string;
 if(result.system_code&&!Object.hasOwn(systemNames,result.system_code))throw new BadRequestException('系统无效');
 if(result.modality&&!['CR','DX','CT','MR','US'].includes(result.modality))throw new BadRequestException('模态无效');
 if(result.source&&result.source!=='synthetic')throw new BadRequestException('当前检索仅支持合成来源');
 if(input.q!==undefined){result.q=(input.q as string).trim();if(result.q.length>200)throw new BadRequestException('检索文本过长');}
 for(const key of ['page','pageSize'] as const)if(input[key]!==undefined){const raw=input[key] as string;if(!/^[1-9]\d*$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw new BadRequestException('分页无效');result[key]=Number(raw);}
 if(result.pageSize>100||!Number.isSafeInteger((result.page-1)*result.pageSize))throw new BadRequestException('分页超出范围');
 return result;
}
