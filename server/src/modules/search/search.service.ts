import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '../auth/auth.models';
import { PermissionService } from '../auth/permission.service';
import { DATABASE_SOURCE } from '../database/database.tokens';
import { accountAvailable } from '../tasks/assignment-release';
import { WorkbenchService } from '../workbench/workbench.service';
import { readAnnotationObjects } from '../annotations/annotation-read';
import { uuid } from '../annotations/annotation-input';
import { ElasticService } from './elastic.service';
import { parseSearch, type SearchInput } from './search-input';
import { publishedPredicate, reportJoin, revisionKey, systemNames } from './published-case';

const projection=`c.id,c.case_no,c.system_code,c.source,c.annotation_version AS version,
 (SELECT jsonb_build_object('id',n.id,'name',n.name) FROM taxonomy_nodes n WHERE n.id=c.disease_tag_id AND n.deleted_at IS NULL) AS disease,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'name',x.name) ORDER BY x.name,x.id) FROM (
  SELECT DISTINCT s.id,s.name FROM annotation_objects a JOIN annotation_tags t ON t.annotation_id=a.id AND t.deleted_at IS NULL
  JOIN sign_tags s ON s.id=t.sign_tag_id AND s.deleted_at IS NULL
  WHERE a.case_id=c.id AND a.version=c.annotation_version AND a.is_gold AND a.deleted_at IS NULL) x),'[]'::jsonb) AS signs,
 COALESCE((SELECT jsonb_agg(x.modality ORDER BY x.modality) FROM(SELECT DISTINCT s.modality FROM series s
  JOIN studies st ON st.id=s.study_id AND st.deleted_at IS NULL WHERE st.case_id=c.id AND s.deleted_at IS NULL)x),'[]'::jsonb) AS modalities,
 (SELECT jsonb_build_object('id',s.id,'series_uid',s.series_uid,'modality',s.modality,'frame_count',s.frame_count,'default_window',s.default_window,
  'frame_index',COALESCE((SELECT min(a.key_frame_index) FROM annotation_objects a WHERE a.case_id=c.id AND a.series_id=s.id AND a.version=c.annotation_version AND a.is_gold AND a.deleted_at IS NULL),0))
  FROM series s JOIN studies st ON st.id=s.study_id AND st.deleted_at IS NULL WHERE st.case_id=c.id AND s.deleted_at IS NULL ORDER BY s.id LIMIT 1) AS thumbnail`;

@Injectable()
export class SearchService {
 constructor(@Inject(DATABASE_SOURCE)private readonly db:DataSource,private readonly elastic:ElasticService,private readonly workbench:WorkbenchService){}
 async search(actor:AuthUser,query:Record<string,unknown>){
  const input=parseSearch(query);
  return this.db.transaction(async manager=>{
   const user=await this.current(manager,actor),scope=await this.filters(manager,user,input);
   let order='c.updated_at DESC,c.id',keys:string[]|undefined;
   if(input.q){
    const candidates=await manager.query(`SELECT ${revisionKey} AS key FROM cases c ${reportJoin} WHERE ${scope.where}`,scope.values) as {key:string}[];
    keys=await this.elastic.match(input.q,candidates.map(c=>c.key));
    scope.where+=` AND ${revisionKey}=ANY($${scope.values.push(keys)}::text[])`;
    order=`array_position($${scope.values.length}::text[],${revisionKey}),c.id`;
   }
   // Repeat all PG filters after ES I/O: stale/foreign ES hits never determine rows or total.
   const [total]=await manager.query(`SELECT count(*)::int AS total FROM cases c ${reportJoin} WHERE ${scope.where}`,scope.values);
   const items=await manager.query(`SELECT ${projection} FROM cases c ${reportJoin} WHERE ${scope.where}
    ORDER BY ${order} LIMIT $${scope.values.length+1} OFFSET $${scope.values.length+2}`,[...scope.values,input.pageSize,(input.page-1)*input.pageSize]);
   await this.current(manager,actor);
   return {items,page:input.page,pageSize:input.pageSize,total:total?.total??0};
  });
 }
 async read(actor:AuthUser,caseValue:string,ip:string){
  const id=uuid(caseValue);
  return this.db.transaction(async manager=>{
   const user=await this.current(manager,actor);
   const [item]=await manager.query(`SELECT c.annotation_version,c.system_code,c.disease_tag_id,c.teaching_fields FROM cases c WHERE c.id=$1 AND ${publishedPredicate}`,[id]);
   if(!item)throw new ForbiddenException('已发布病例不可访问');
   const permission=new PermissionService(manager as unknown as DataSource);
   await permission.assertPublishedCase(user,id,item.system_code,item.annotation_version);
   const data=await this.workbench.readInTransaction(manager,user,id,ip,'library',item.annotation_version);
   const annotations=await readAnnotationObjects(manager,id,item.annotation_version);
   const [disease]=await manager.query('SELECT id,name FROM taxonomy_nodes WHERE id=$1 AND deleted_at IS NULL',[item.disease_tag_id]);
   await permission.assertPublishedCase(user,id,item.system_code,item.annotation_version);
   return {...data,version:item.annotation_version,current_version:item.annotation_version,annotations,disease:disease??null,teaching_fields:item.teaching_fields};
  });
 }
 private async current(manager:EntityManager,actor:AuthUser):Promise<AuthUser>{
  const [user]=await manager.query('SELECT *,expire_at::text FROM users WHERE id=$1 AND deleted_at IS NULL FOR NO KEY UPDATE',[actor.id]) as AuthUser[];
  if(!user||!accountAvailable(user)||user.updated_at.getTime()!==actor.updated_at.getTime())throw new ForbiddenException('账号或会话已失效');
  return user;
 }
 private async filters(manager:EntityManager,user:AuthUser,input:SearchInput){
  const systems=Object.keys(systemNames).filter(s=>user.quals[s]?.some(q=>q==='annotate'||q==='review'));
  if(!systems.length||(input.system_code&&!systems.includes(input.system_code)))throw new ForbiddenException('缺少对应系统资格');
  const values:unknown[]=[systems];const clauses=[publishedPredicate,'c.system_code=ANY($1::text[])'];
  if(input.system_code)clauses.push(`c.system_code=$${values.push(input.system_code)}`);
  for(const [key,levels] of [['part_id',[2]],['disease_id',[3,4]],['sign_tag_id',null]] as const){
   if(!input[key])continue;
   const [tag]=await manager.query(`SELECT id${levels?',level':''} FROM ${levels?'taxonomy_nodes':'sign_tags'} WHERE id=$1 AND deleted_at IS NULL`,[input[key]]);
   if(!tag||(levels&&!levels.some(level=>level===tag.level)))throw new BadRequestException('标签不存在或层级不符');
  }
  for(const key of ['part_id','disease_id'] as const)if(input[key]){
   const p=values.push(input[key]);
   const descendants=`c.disease_tag_id IN(WITH RECURSIVE nodes AS(SELECT id FROM taxonomy_nodes WHERE id=$${p} AND deleted_at IS NULL
    UNION ALL SELECT n.id FROM taxonomy_nodes n JOIN nodes p ON n.parent_id=p.id WHERE n.deleted_at IS NULL)SELECT id FROM nodes)`;
   clauses.push(key==='disease_id'?descendants:`(${descendants} OR EXISTS(SELECT 1 FROM annotation_objects a WHERE a.case_id=c.id AND a.version=c.annotation_version AND a.is_gold AND a.deleted_at IS NULL AND a.part_id=$${p}))`);
  }
  if(input.sign_tag_id)clauses.push(`EXISTS(SELECT 1 FROM annotation_objects a JOIN annotation_tags t ON t.annotation_id=a.id AND t.deleted_at IS NULL WHERE a.case_id=c.id AND a.version=c.annotation_version AND a.is_gold AND a.deleted_at IS NULL AND t.sign_tag_id=$${values.push(input.sign_tag_id)})`);
  if(input.modality)clauses.push(`EXISTS(SELECT 1 FROM studies st JOIN series s ON s.study_id=st.id AND s.deleted_at IS NULL WHERE st.case_id=c.id AND st.deleted_at IS NULL AND s.modality=$${values.push(input.modality)})`);
  return {where:clauses.join(' AND '),values};
 }
}
