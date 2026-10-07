import {BadRequestException,ConflictException,ForbiddenException,Inject,Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {DataSource,EntityManager} from 'typeorm';
import type {AuthUser} from '../auth/auth.models';
import {DATABASE_SOURCE} from '../database/database.tokens';
import {object,parseAnnotations,uuid} from '../annotations/annotation-input';
import {readAnnotationObjects} from '../annotations/annotation-read';
import {publishedPredicate} from '../search/published-case';
import {AttachmentObjectService} from '../cases/attachment-object.service';
import {ObjectCompensationService} from '../cases/object-compensation.service';
import {OrthancService} from '../cases/orthanc.service';
import {accountAvailable} from '../tasks/assignment-release';
import {lockAdmins,pageInput} from './exports-input';
interface Version {id:string;version:number}
interface Request {id:string;requester_id:string;approver_id:string|null;case_versions:Version[];status:string;expire_at:Date|null;download_count:number;package_sha256:string|null}
@Injectable()
export class ExportsService {
 constructor(@Inject(DATABASE_SOURCE)private readonly db:DataSource,private readonly objects:AttachmentObjectService,
  private readonly compensation:ObjectCompensationService,private readonly orthanc:OrthancService){}
 async candidates(actor:AuthUser,q:Record<string,unknown>){
  const {page,pageSize}=pageInput(q);return this.db.transaction(async m=>{await lockAdmins(m,actor);
   const [result]=await m.query(`WITH eligible AS MATERIALIZED(SELECT c.id,c.source,c.system_code,c.annotation_version AS version FROM cases c WHERE ${publishedPredicate})
    SELECT (SELECT count(*)::int FROM eligible) total,COALESCE((SELECT jsonb_agg(x ORDER BY x.id) FROM(SELECT * FROM eligible ORDER BY id LIMIT $1 OFFSET $2)x),'[]'::jsonb) items`,[pageSize,(page-1)*pageSize]);return {...result,page,pageSize};});
 }
 async list(actor:AuthUser,q:Record<string,unknown>){
  const {page,pageSize}=pageInput(q);return this.db.transaction(async m=>{await lockAdmins(m,actor);
   const [result]=await m.query(`WITH rows AS MATERIALIZED(SELECT id,requester_id,approver_id,status,case_versions,created_at,expire_at,download_count,CASE WHEN requester_id=$1 THEN url ELSE NULL END url
    FROM export_requests WHERE deleted_at IS NULL) SELECT (SELECT count(*)::int FROM rows) total,
    COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC,x.id DESC) FROM(SELECT * FROM rows ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3)x),'[]'::jsonb) items`,[actor.id,pageSize,(page-1)*pageSize]);return {...result,page,pageSize};});
 }
 async create(actor:AuthUser,body:unknown,ip:string){
  const input=object(body,['case_ids']);if(!Array.isArray(input.case_ids)||input.case_ids.length<1||input.case_ids.length>20)throw new BadRequestException('请选择 1～20 个病例');
  const ids=input.case_ids.map(uuid).sort();if(new Set(ids).size!==ids.length)throw new BadRequestException('病例不可重复');
  return this.db.transaction(async m=>{await lockAdmins(m,actor);const versions=await this.versions(m,ids);
   const [row]=await m.query("INSERT INTO export_requests(status,requester_id,case_versions) VALUES('待审批',$1,$2) RETURNING id,status",[actor.id,JSON.stringify(versions)]);
   await this.audit(m,actor.id,'exports.requested',row.id,{case_count:ids.length,case_versions:versions},ip);return row;});
 }
 async decide(actor:AuthUser,value:string,body:unknown,ip:string){
  const id=uuid(value),input=object(body,['decision']);if(!['approve','reject'].includes(input.decision as string))throw new BadRequestException('审批结论无效');
  let intent:string|undefined;
  try{
   const result=await this.db.transaction(async m=>{
    const prior=await this.find(m,id);const admins=await lockAdmins(m,actor,[prior.requester_id]);const row=await this.find(m,id,true);
    if(actor.id===row.requester_id)throw new ForbiddenException('不能审批自己的申请');if(row.status!=='待审批')throw new ConflictException('申请已处理，请刷新');
    if(input.decision==='reject'){await m.query("UPDATE export_requests SET status='已拒绝',approver_id=$2,updated_at=clock_timestamp() WHERE id=$1",[id,actor.id]);await this.audit(m,actor.id,'exports.rejected',id,{},ip);return {id,status:'已拒绝'};}
    await this.versions(m,row.case_versions.map(v=>v.id),row.case_versions);
    const data=[];
    for(const version of row.case_versions){
     const [c]=await m.query('SELECT id,source,system_code,disease_tag_id FROM cases WHERE id=$1',[version.id]);
     const raw=await readAnnotationObjects(m,version.id,version.version);
     const annotations=parseAnnotations({expected_version:version.version,annotations:raw.map(({version:_,is_gold:__,...a}:Record<string,unknown>)=>a)}).annotations;
     if(annotations.some(a=>a.window_preset!==null&&!['lung','mediastinum','bone','肺窗','纵隔窗','骨窗'].includes(a.window_preset)))throw new BadRequestException('窗预设不在导出范围');
     const series=await m.query(`SELECT s.id,s.modality,s.frame_count,s.default_window,s.series_uid,s.orthanc_id FROM series s JOIN studies st ON st.id=s.study_id
      WHERE st.case_id=$1 AND st.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY s.id FOR SHARE OF s,st`,[version.id]);
     if(annotations.some(a=>!series.some((s:{id:string})=>s.id===a.series_id)))throw new ForbiddenException('标注序列已失效');
     const safeSeries=[];
     for(const s of series){
      const frames=[];for(const index of new Set([0,...annotations.filter(a=>a.series_id===s.id).map(a=>a.key_frame_index)])){
       const resolved=await this.orthanc.resolveSeriesFrame(s.orthanc_id,s.series_uid,index,s.frame_count),g=await this.orthanc.frameGeometry(resolved.instance_id,resolved.frame_index);
       frames.push({frame_index:index,width:g.width,height:g.height,row_spacing:g.row_spacing,column_spacing:g.column_spacing});
      }
      const window=s.default_window;const default_window=window&&typeof window.center==='number'&&typeof window.width==='number'?{center:window.center,width:window.width}:null;
      safeSeries.push({id:s.id,modality:s.modality,frame_count:s.frame_count,default_window,frames});
     }
     data.push({...c,version:version.version,annotations,series:safeSeries});
    }
    const bytes=Buffer.from(JSON.stringify({schema_version:1,cases:data}));if(bytes.length>5*1024*1024)throw new BadRequestException('导出包超过 5 MiB，请减少病例');
    intent=await this.compensation.reserve(this.key(id),0);await this.objects.storeJson(this.key(id),bytes);
    if(admins.some(u=>!accountAvailable(u)))throw new ForbiddenException('管理员账号已过期');
    const [saved]=await m.query("UPDATE export_requests SET status='已批准',approver_id=$2,expire_at=clock_timestamp()+interval '24 hours',url=$3,package_sha256=$4,updated_at=clock_timestamp() WHERE id=$1 RETURNING id,status,expire_at",[id,actor.id,`/api/exports/${id}/download`,this.hash(bytes)]);
    await this.audit(m,actor.id,'exports.approved',id,{case_count:row.case_versions.length,package_sha256:this.hash(bytes)},ip);return saved;
   });
   if(intent)await this.compensation.complete(intent);return result;
  }catch(error){if(intent)await this.compensation.compensate(intent);throw error;}
 }
 async download(actor:AuthUser,value:string,ip:string){
  const id=uuid(value);const result=await this.db.transaction(async m=>{
   const prior=await this.find(m,id);
   let row:Request=prior,bytes:Buffer|undefined,error:ForbiddenException|ServiceUnavailableException|undefined;
   try{
    const admins=await lockAdmins(m,actor,prior.requester_id===actor.id&&prior.approver_id?[prior.approver_id]:[]);
    row=await this.find(m,id,true);
    if(actor.id!==row.requester_id)throw new ForbiddenException('仅申请人可以领取');
    if(row.status!=='已批准'||!row.expire_at||row.expire_at.getTime()<=Date.now()||row.download_count!==0)throw new ForbiddenException('链接已失效或已领取');
    await this.versions(m,row.case_versions.map(v=>v.id),row.case_versions);
    try{bytes=await this.objects.readJson(this.key(id));}catch{throw new ServiceUnavailableException('导出包读取失败，可稍后重试');}
    if(this.hash(bytes)!==row.package_sha256)throw new ServiceUnavailableException('导出包完整性校验失败');
    if(row.expire_at.getTime()<=Date.now())throw new ForbiddenException('链接已到期');
    if(admins.some(u=>!accountAvailable(u)))throw new ForbiddenException('管理员账号已过期');
   }catch(e){if(e instanceof ForbiddenException||e instanceof ServiceUnavailableException)error=e;else throw e;}
   if(error){await this.audit(m,actor.id,'exports.download_denied',id,{reason:error instanceof ServiceUnavailableException?'object_unavailable':'scope_or_link_unavailable'},ip);return {error};}
   await m.query('UPDATE export_requests SET download_count=1,updated_at=clock_timestamp() WHERE id=$1',[id]);await this.audit(m,actor.id,'exports.downloaded',id,{download_count:1,package_sha256:row.package_sha256},ip);return {bytes};
  });if(result.error)throw result.error;return result.bytes!;
 }
 private async find(m:EntityManager,id:string,lock=false):Promise<Request>{const [row]=await m.query('SELECT * FROM export_requests WHERE id=$1 AND deleted_at IS NULL'+(lock?' FOR UPDATE':''),[id]);if(!row)throw new NotFoundException('导出申请不存在');return row;}
 private async versions(m:EntityManager,ids:string[],expected?:Version[]):Promise<Version[]>{
  const rows=await m.query(`SELECT c.id,c.annotation_version AS version FROM cases c WHERE c.id=ANY($1::uuid[]) AND ${publishedPredicate} ORDER BY c.id FOR SHARE OF c`,[ids]) as Version[];
  if(rows.length!==ids.length||expected?.some(v=>!rows.some(c=>c.id===v.id&&c.version===v.version)))throw new ForbiddenException('病例来源、发布状态或版本不可导出');return rows;
 }
 private key(id:string){return `exports/${id}.json`;}
 private hash(bytes:Buffer){return createHash('sha256').update(bytes).digest('hex');}
 private audit(m:EntityManager,actor:string,action:string,id:string,detail:unknown,ip:string){return m.query('INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES($1,$2,$3,$4,$5)',[actor,action,'exports:'+id,JSON.stringify(detail),ip]);}
}
