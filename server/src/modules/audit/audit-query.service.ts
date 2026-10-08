import {BadRequestException,Inject,Injectable} from '@nestjs/common';
import type {DataSource} from 'typeorm';
import type {AuthUser} from '../auth/auth.models';
import {DATABASE_SOURCE} from '../database/database.tokens';
import {uuid} from '../annotations/annotation-input';
import {lockAdmins,pageInput} from '../exports/exports-input';
// Known event metadata only. Free text, credentials, mappings, UIDs and private paths never pass through.
const safeKeys=new Set(['version','expected_version','task_id','case_id','assignment_id','review_id','review_kind','result','frame_index','page','case_count','download_count','count','source','system_code','reason','state','phase','executor','package_sha256','case_versions','id']);
function accountDetail(key:string,value:unknown):unknown {
 if(value&&typeof value==='object'&&!Array.isArray(value)&&('before'in value||'after'in value))return Object.fromEntries(Object.entries(value).filter(([k])=>k==='before'||k==='after').map(([k,v])=>[k,accountDetail(key,v)]));
 if(key==='quals'&&value&&typeof value==='object'&&!Array.isArray(value))return Object.fromEntries(Object.entries(value).filter(([system,entries])=>['cns','headneck','resp','circ','digest','uro','repro','bone'].includes(system)&&Array.isArray(entries)&&entries.every(e=>e==='annotate'||e==='review')));
 if(key==='mfa_reset')return value===true;
 if(key==='role')return value==='admin'||value==='member'?value:null;
 if(key==='status')return value==='active'||value==='disabled'?value:null;
 if(key==='expire_at')return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:null;
 return null;
}
export function safeAuditDetail(value:unknown):unknown {
 if(!value||typeof value!=='object'||Array.isArray(value))return {};
 return Object.fromEntries(Object.entries(value).filter(([key])=>safeKeys.has(key)||['role','status','expire_at','quals','mfa_reset'].includes(key)).flatMap(([key,item])=>{
  if(['role','status','expire_at','quals','mfa_reset'].includes(key))return [[key,accountDetail(key,item)]];
  if(typeof item==='number'||typeof item==='boolean'||item===null)return [[key,item]];
  if(typeof item==='string'&&(/^[a-zA-Z0-9_.:-]{1,128}$/.test(item)||['通过','打回','待审批','已批准','已拒绝'].includes(item)))return [[key,item]];
  if(key==='case_versions'&&Array.isArray(item))return [[key,item.map(safeAuditDetail)]];return [];
 }));
}
@Injectable()
export class AuditQueryService {
 constructor(@Inject(DATABASE_SOURCE)private readonly db:DataSource){}
 async list(actor:AuthUser,q:Record<string,unknown>){
  const {page,pageSize}=pageInput(q,['actor','action','target','from','to']);const values:unknown[]=[],clauses:string[]=[];
  if(q.actor!==undefined)clauses.push(`a.actor=$${values.push(uuid(q.actor))}`);
  for(const key of ['action','target'] as const)if(q[key]!==undefined){if(typeof q[key]!=='string'||!/^[a-zA-Z0-9_.:-]{1,128}$/.test(q[key]))throw new BadRequestException('审计条件无效');clauses.push(`a.${key}=$${values.push(q[key])}`);}
  for(const [key,operator]of [['from','>='],['to','<']] as const)if(q[key]!==undefined){const v=q[key];if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v.slice(0,19)+'Z').toISOString().slice(0,19)!==v.slice(0,19))throw new BadRequestException('审计时间无效');clauses.push(`a.created_at${operator}$${values.push(v)}::timestamptz`);}
  if(q.from&&q.to&&Date.parse(q.from as string)>=Date.parse(q.to as string))throw new BadRequestException('审计时间范围无效');
  return this.db.transaction(async m=>{await lockAdmins(m,actor);await m.query("SET LOCAL statement_timeout='5s'");
   const [data]=await m.query(`WITH rows AS MATERIALIZED(SELECT a.id,a.actor,a.action,a.target,a.detail,a.ip,a.created_at FROM audit_logs a ${clauses.length?'WHERE '+clauses.join(' AND '):''})
    SELECT (SELECT count(*)::int FROM rows) total,COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC,x.id DESC) FROM(SELECT * FROM rows ORDER BY created_at DESC,id DESC LIMIT $${values.length+1} OFFSET $${values.length+2})x),'[]'::jsonb) items`,[...values,pageSize,(page-1)*pageSize]);
   return {...data,items:data.items.map((i:{detail:unknown})=>({...i,detail:safeAuditDetail(i.detail)})),page,pageSize};});
 }
}
