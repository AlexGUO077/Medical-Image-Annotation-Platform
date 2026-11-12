import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { DATABASE_SOURCE } from '../database/database.tokens';
import type { AuthUser } from '../auth/auth.models';
import { hashPassword } from '../../database/password';
import { SecurityStateService } from '../auth/security-state.service';
import { object, integer, uuid } from '../annotations/annotation-input';
import { readAnnotationObjects } from '../annotations/annotation-read';
import { OrthancService } from '../cases/orthanc.service';
import { educationActor, educationContext } from './education-access';
import { emptyAnswer, ids, parseAnswer, publicAnswer, studentNumber, submissionCheck, text, type StudentAnswer } from './education-input';

const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
@Injectable()
export class EducationService {
  constructor(@Inject(DATABASE_SOURCE) private readonly db:DataSource,private readonly security:SecurityStateService,private readonly orthanc:OrthancService){}
  private audit(m:EntityManager,actor:string,action:string,target:string,ip:string,detail:Record<string,unknown>={}){
    return m.query('INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES($1,$2,$3,$4::jsonb,$5)',[actor,`education.${action}`,target,JSON.stringify(detail),ip]);
  }
  private page(query:Record<string,unknown>){
    if(Object.keys(query).some(k=>k!=='page'))throw new BadRequestException('查询参数无效');
    const page=query.page===undefined?1:Number(query.page);
    if(!Number.isInteger(page)||page<1||page>100000)throw new BadRequestException('页码无效');return (page-1)*50;
  }
  async roster(actor:AuthUser,query:Record<string,unknown>){const offset=this.page(query);return this.db.transaction(async m=>{
    await educationActor(m,actor,'admin');
    return m.query(`SELECT id,student_no,real_name,class_name,expire_at::text,user_id,activated_at FROM education_roster
      WHERE deleted_at IS NULL ORDER BY created_at,id LIMIT 50 OFFSET $1`,[offset]);
  });}
  async createRoster(actor:AuthUser,body:unknown,ip:string){
    const b=object(body,['student_no','real_name','class_name','expire_at']);const no=studentNumber(b.student_no),name=text(b.real_name,100,true),group=text(b.class_name??'',100);
    if(typeof b.expire_at!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.expire_at)||Number.isNaN(Date.parse(b.expire_at))||new Date(b.expire_at).toISOString().slice(0,10)!==b.expire_at||b.expire_at<new Date().toISOString().slice(0,10))throw new BadRequestException('有效期无效');
    const code=randomBytes(24).toString('base64url');
    try{return await this.db.transaction(async m=>{
      await educationActor(m,actor,'admin');
      const [row]=await m.query(`INSERT INTO education_roster(student_no,real_name,class_name,expire_at,activation_hash,activation_expires_at)
        VALUES($1,$2,$3,$4,$5,now()+interval '7 days') RETURNING id`,[no,name,group,b.expire_at,digest(code)]);
      await this.audit(m,actor.id,'roster_created',`education_roster:${row.id}`,ip);
      return {id:row.id,activation_code:code};
    });}catch(e){if((e as {code?:string}).code==='23505')throw new ConflictException('该学号已录入');throw e;}
  }
  async reissue(actor:AuthUser,idValue:string,ip:string){const id=uuid(idValue),code=randomBytes(24).toString('base64url');return this.db.transaction(async m=>{
    await educationActor(m,actor,'admin');const [row]=await m.query('SELECT id,user_id FROM education_roster WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[id]);
    if(!row||row.user_id)throw new BadRequestException('只能为未激活名册重发激活码');
    await m.query(`UPDATE education_roster SET activation_hash=$2,activation_expires_at=now()+interval '7 days',updated_at=now() WHERE id=$1`,[id,digest(code)]);
    await this.audit(m,actor.id,'activation_reissued',`education_roster:${id}`,ip);return {id,activation_code:code};
  });}
  async activate(body:unknown,ip:string){
    const b=object(body,['student_no','activation_code','password']);
    await this.security.assertActivationNetworkAllowed(ip);
    const no=studentNumber(b.student_no),code=text(b.activation_code,128,true),password=b.password;
    if(typeof password!=='string'||password.length>128)throw new BadRequestException('密码无效');
    await this.security.assertAttemptAllowed('password',`education-activation:${no}`);
    if(password.length<12||!/[A-Za-z]/.test(password)||!/\d/.test(password))throw new BadRequestException('密码至少12位，包含字母和数字');
    try{return await this.db.transaction(async m=>{
      const [row]=await m.query(`SELECT *,expire_at::text FROM education_roster WHERE student_no=$1 AND deleted_at IS NULL FOR UPDATE`,[no]);
      if(!row||row.user_id||row.activation_hash!==digest(code)||!row.activation_expires_at||new Date(row.activation_expires_at).getTime()<=Date.now()||row.expire_at<new Date().toISOString().slice(0,10))throw new BadRequestException('激活信息无效或已过期');
      const [user]=await m.query(`INSERT INTO users(username,password_hash,real_name,role,quals,status,expire_at,must_change_password)
        VALUES($1,$2,$3,'student','{}','active',$4,false) RETURNING id`,[no,hashPassword(password),row.real_name,row.expire_at]);
      await m.query('UPDATE education_roster SET user_id=$2,activation_hash=NULL,activation_expires_at=NULL,activated_at=now(),updated_at=now() WHERE id=$1',[row.id,user.id]);
      await this.audit(m,user.id,'activated',`education_roster:${row.id}`,ip);return {username:no};
    });}catch(e){if((e as {code?:string}).code==='23505')throw new ConflictException('激活信息不可用，请联系管理员');throw e;}
  }
  async candidates(actor:AuthUser,query:Record<string,unknown>){const offset=this.page(query);return this.db.transaction(async m=>{
    await educationActor(m,actor,'admin');return m.query(`SELECT c.id,c.case_no,c.source,c.status FROM cases c WHERE ${this.eligibleCase()}
      ORDER BY c.created_at,c.id LIMIT 50 OFFSET $1`,[offset]);
  });}
  private eligibleCase(){return `c.deleted_at IS NULL AND c.status<>'已下线' AND c.source IN ('synthetic','teacher_provided_teaching')
    AND EXISTS(SELECT 1 FROM reports r WHERE r.case_id=c.id AND r.deleted_at IS NULL AND length(trim(r.raw_text))>0)
    AND EXISTS(SELECT 1 FROM studies st JOIN series s ON s.study_id=st.id AND s.deleted_at IS NULL WHERE st.case_id=c.id AND st.deleted_at IS NULL)
    AND EXISTS(SELECT 1 FROM audit_logs WHERE target='cases:'||c.id::text AND action IN ('case_import.deidentification_confirmed','case_manual.confirmed'))`;}
  async createTask(actor:AuthUser,body:unknown,ip:string){
    const b=object(body,['title','instructions','case_ids','roster_ids','reference_sections']),title=text(b.title,200,true),instructions=text(b.instructions??'',4000),cases=ids(b.case_ids,50).sort(),roster=ids(b.roster_ids,500).sort();
    if(!Array.isArray(b.reference_sections)||b.reference_sections.length!==cases.length)throw new BadRequestException('请为每例病灶题核对医生的影像所见和诊断意见');
    const excerpts=new Map(b.reference_sections.map(value=>{
      const entry=object(value,['case_id','findings','impression']);
      const findings=text(entry.findings,10000,true),impression=text(entry.impression,5000,true);
      return [uuid(entry.case_id),{findings,impression}] as const;
    }));
    if(cases.some(id=>!excerpts.has(id)))throw new BadRequestException('参考报告与所选病例不一致');
    return this.db.transaction(async m=>{
      await educationActor(m,actor,'admin');
      const people=await m.query('SELECT id FROM education_roster WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL AND expire_at>=CURRENT_DATE ORDER BY id FOR SHARE',[roster]);
      if(people.length!==roster.length)throw new BadRequestException('学生名册不存在或已过期');
      const sources=await m.query(`SELECT c.id,c.annotation_version FROM cases c WHERE c.id=ANY($1::uuid[]) AND ${this.eligibleCase()} ORDER BY c.id FOR SHARE`,[cases]);
      if(sources.length!==cases.length)throw new BadRequestException('病例未满足教学使用条件');
      const [task]=await m.query(`INSERT INTO education_tasks(title,instructions,status,created_by) VALUES($1,$2,'published',$3) RETURNING id`,[title,instructions,actor.id]);
      for(let n=0;n<sources.length;n++){
        const source=sources[n];const [report]=await m.query('SELECT raw_text FROM reports WHERE case_id=$1 AND deleted_at IS NULL FOR SHARE',[source.id]);
        const sections=excerpts.get(source.id)!;
        if(!report||!report.raw_text.includes(sections.findings)||!report.raw_text.includes(sections.impression))throw new BadRequestException('所见和诊断意见须取自该病例当前的脱敏报告，请重新核对');
        const series=await m.query(`SELECT s.id FROM series s JOIN studies st ON st.id=s.study_id WHERE st.case_id=$1 AND st.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY s.id FOR SHARE OF s,st`,[source.id]);
        const standard=await readAnnotationObjects(m,source.id,source.annotation_version) as Record<string,unknown>[];
        const annotations=standard.length&&standard.every(a=>a.is_gold)?standard.map(({id,series_id,tool,geometry,frame_start,frame_end,key_frame_index,window_preset,part_id,confidence,sign_tag_ids})=>({id,series_id,tool,geometry,frame_start,frame_end,key_frame_index,window_preset,part_id,confidence,sign_tag_ids,report_sent_ids:[]})):[];
        const parts=await m.query('SELECT name FROM taxonomy_nodes WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL',[[...new Set(annotations.map(a=>a.part_id).filter(Boolean))]]);
        const reference={report:report.raw_text,...sections,annotations,part_names:parts.map((p:{name:string})=>p.name),version:source.annotation_version};
        await m.query('INSERT INTO education_items(task_id,case_id,ordinal,reference_version,series_ids,reference) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[task.id,source.id,n+1,source.annotation_version,JSON.stringify(series.map((s:{id:string})=>s.id)),JSON.stringify(reference)]);
      }
      await m.query('INSERT INTO education_students(task_id,roster_id) SELECT $1,unnest($2::uuid[])',[task.id,roster]);
      await this.audit(m,actor.id,'task_created',`education_tasks:${task.id}`,ip,{case_count:cases.length,student_count:roster.length});return {id:task.id};
    });
  }
  async tasks(actor:AuthUser,query:Record<string,unknown>){const offset=this.page(query);return this.db.transaction(async m=>{
    await educationActor(m,actor,actor.role==='admin'?'admin':'student');
    const tasks=await m.query(`SELECT t.id,t.title,t.instructions,t.status FROM education_tasks t WHERE t.deleted_at IS NULL
      AND ($2::boolean OR (t.status<>'revoked' AND EXISTS(SELECT 1 FROM education_students es JOIN education_roster r ON r.id=es.roster_id AND r.deleted_at IS NULL
      WHERE es.task_id=t.id AND es.deleted_at IS NULL AND r.user_id=$1))) ORDER BY t.created_at DESC,t.id LIMIT 50 OFFSET $3`,[actor.id,actor.role==='admin',offset]);
    for(const task of tasks)task.items=await m.query(`SELECT i.id,i.ordinal,a.id attempt_id,a.state FROM education_items i
      LEFT JOIN education_attempts a ON a.item_id=i.id AND a.student_id=$2 AND a.deleted_at IS NULL WHERE i.task_id=$1 AND i.deleted_at IS NULL ORDER BY i.ordinal`,[task.id,actor.id]);
    return tasks;
  });}
  async taskState(actor:AuthUser,idValue:string,body:unknown,ip:string){const id=uuid(idValue),b=object(body,['status']);if(!['closed','revoked'].includes(b.status as string))throw new BadRequestException('状态无效');return this.db.transaction(async m=>{
    await educationActor(m,actor,'admin');const rows=await m.query('WITH changed AS (UPDATE education_tasks SET status=$2,updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id) SELECT * FROM changed',[id,b.status]);
    if(!rows.length)throw new BadRequestException('考核不存在');await this.audit(m,actor.id,'task_state_changed',`education_tasks:${id}`,ip,{status:b.status});return {id,status:b.status};
  });}
  async submissions(actor:AuthUser,idValue:string,query:Record<string,unknown>){const id=uuid(idValue),offset=this.page(query);return this.db.transaction(async m=>{
    await educationActor(m,actor,'admin');return m.query(`SELECT a.id,a.state,a.submitted_at,a.version,a.answer,i.ordinal,r.student_no,r.real_name
      FROM education_attempts a JOIN education_items i ON i.id=a.item_id JOIN education_roster r ON r.user_id=a.student_id
      WHERE i.task_id=$1 AND a.state='submitted' AND a.deleted_at IS NULL ORDER BY a.submitted_at,a.id LIMIT 50 OFFSET $2`,[id,offset]);
  });}
  async start(actor:AuthUser,itemValue:string,ip:string){const item=uuid(itemValue);return this.db.transaction(async m=>{
    await educationActor(m,actor,'student');
    const [allowed]=await m.query(`SELECT i.id FROM education_items i JOIN education_tasks t ON t.id=i.task_id AND t.deleted_at IS NULL AND t.status='published'
      JOIN education_students es ON es.task_id=t.id AND es.deleted_at IS NULL JOIN education_roster r ON r.id=es.roster_id AND r.user_id=$2 AND r.deleted_at IS NULL
      JOIN cases c ON c.id=i.case_id WHERE i.id=$1 AND i.deleted_at IS NULL AND ${this.eligibleCase()} FOR SHARE OF t,i,es,r,c`,[item,actor.id]);
    if(!allowed)throw new ForbiddenException('考核不可开始');
    await m.query(`INSERT INTO education_attempts(item_id,student_id,answer) VALUES($1,$2,$3::jsonb) ON CONFLICT(item_id,student_id) DO NOTHING`,[item,actor.id,JSON.stringify(emptyAnswer())]);
    const [attempt]=await m.query('SELECT id FROM education_attempts WHERE item_id=$1 AND student_id=$2',[item,actor.id]);
    await this.audit(m,actor.id,'attempt_opened',`education_attempts:${attempt.id}`,ip);return attempt;
  });}
  private async response(m:EntityManager,context:Awaited<ReturnType<typeof educationContext>>){
    const series=await m.query(`SELECT s.id,s.series_uid,s.modality,s.frame_count,s.default_window FROM series s JOIN studies st ON st.id=s.study_id
      WHERE st.case_id=$1 AND st.deleted_at IS NULL AND s.deleted_at IS NULL AND s.id=ANY($2::uuid[]) ORDER BY s.created_at,s.id`,[context.case_id,context.series_ids]);
    const parts=await m.query(`SELECT n.id,root.name||' / '||n.name AS name FROM taxonomy_nodes n JOIN taxonomy_nodes root ON root.id=n.parent_id AND root.deleted_at IS NULL WHERE n.level=2 AND n.deleted_at IS NULL ORDER BY root.name,n.name,n.id`);
    const signs=await m.query('SELECT id,name FROM sign_tags WHERE deleted_at IS NULL ORDER BY name,id');
    return {attempt:{id:context.id,state:context.state,version:context.version,answer:publicAnswer(context.answer),submitted_at:context.submitted_at},
      item:{id:context.item_id,case_id:context.case_id,ordinal:context.ordinal},task:{title:context.title,instructions:context.instructions,status:context.task_status},series,parts,signs};
  }
  async workbench(actor:AuthUser,idValue:string,ip:string,feedback=false){const id=uuid(idValue);return this.db.transaction(async m=>{
    await educationActor(m,actor,'student');const context=await educationContext(m,actor.id,id);
    if(feedback&&context.state!=='submitted')throw new ForbiddenException('提交后可查看参考');
    const result=await this.response(m,context);await this.audit(m,actor.id,feedback?'feedback_viewed':'workbench_viewed',`education_attempts:${id}`,ip);
    if(!feedback)return result;const [item]=await m.query('SELECT reference FROM education_items WHERE id=$1',[context.item_id]);return {...result,reference:item.reference};
  });}
  async save(actor:AuthUser,idValue:string,body:unknown,ip:string){const id=uuid(idValue),{version,answer}=parseAnswer(body);return this.db.transaction(async m=>{
    await educationActor(m,actor,'student');const ctx=await educationContext(m,actor.id,id);
    if(ctx.state!=='in_progress'||ctx.task_status!=='published')throw new ConflictException('答卷已提交或考核已关闭');
    if(ctx.version!==version||version===2147483647)throw new ConflictException('作答版本冲突，请重新载入');
    await this.validate(m,ctx,answer);
    const [saved]=await m.query(`WITH changed AS (UPDATE education_attempts SET answer=$2::jsonb,version=version+1,updated_at=now() WHERE id=$1 AND version=$3 AND state='in_progress' RETURNING version) SELECT * FROM changed`,[id,JSON.stringify(answer),version]);
    if(!saved)throw new ConflictException('作答版本冲突，请重新载入');await this.audit(m,actor.id,'draft_saved',`education_attempts:${id}`,ip,{version:saved.version});return {version:saved.version};
  });}
  async submit(actor:AuthUser,idValue:string,body:unknown,ip:string){const id=uuid(idValue),b=object(body,['expected_version']),version=integer(b.expected_version);return this.db.transaction(async m=>{
    await educationActor(m,actor,'student');const ctx=await educationContext(m,actor.id,id);
    if(ctx.version!==version)throw new ConflictException('作答版本冲突，请重新载入');
    if(ctx.state==='submitted')return {id,state:ctx.state,version,submitted_at:ctx.submitted_at};
    if(ctx.task_status!=='published')throw new ForbiddenException('考核已关闭');submissionCheck(ctx.answer);await this.validate(m,ctx,ctx.answer);
    const [row]=await m.query(`WITH changed AS (UPDATE education_attempts SET state='submitted',submitted_at=now(),updated_at=now() WHERE id=$1 AND version=$2 AND state='in_progress' RETURNING id,state,version,submitted_at) SELECT * FROM changed`,[id,version]);
    if(!row)throw new ConflictException('作答已变化');await this.audit(m,actor.id,'submitted',`education_attempts:${id}`,ip,{version});return row;
  });}
  private async validate(m:EntityManager,ctx:Awaited<ReturnType<typeof educationContext>>,a:StudentAnswer){
    const partIds=[...new Set([a.body_part_id,...a.objects.map(o=>o.part_id)].filter(Boolean))];
    const parts=await m.query('SELECT id FROM taxonomy_nodes WHERE id=ANY($1::uuid[]) AND level=2 AND deleted_at IS NULL',[partIds]);
    const signs=[...new Set(a.objects.flatMap(o=>o.sign_tag_ids))],tags=await m.query('SELECT id FROM sign_tags WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL',[signs]);
    if(parts.length!==partIds.length||tags.length!==signs.length)throw new BadRequestException('部位或征象无效');
    const sources=await m.query(`SELECT s.id,s.series_uid,s.orthanc_id,s.frame_count,s.modality FROM series s JOIN studies st ON st.id=s.study_id
      WHERE st.case_id=$1 AND st.deleted_at IS NULL AND s.deleted_at IS NULL AND s.id=ANY($2::uuid[]) FOR SHARE OF s,st`,[ctx.case_id,ctx.series_ids]);
    const sizes=new Map<string,{width:number;height:number}>();
    for(const o of a.objects){const s=sources.find((s:{id:string})=>s.id===o.series_id);
      if(!s||o.frame_end>=s.frame_count)throw new BadRequestException('对象序列或帧号无效');
      if(s.modality==='CT'&&!o.window_preset)throw new BadRequestException('CT对象需记录窗宽窗位');
      for(const frame of [o.key_frame_index,...((o.geometry.frames??[]) as {frame_index:number}[]).map(f=>f.frame_index)]){
        const key=`${s.id}:${frame}`;let size=sizes.get(key);
        if(!size){const resolved=await this.orthanc.resolveSeriesFrame(s.orthanc_id,s.series_uid,frame,s.frame_count);size=await this.orthanc.frameGeometry(resolved.instance_id,resolved.frame_index);sizes.set(key,size);}
        const g=o.geometry,inside=(x:unknown,y:unknown)=>typeof x==='number'&&typeof y==='number'&&x>=0&&y>=0&&x<size!.width&&y<size!.height;
        if(o.tool==='brush'?g.width!==size.width||g.height!==size.height:o.tool==='polygon'?(g.points as number[][]).some(p=>!inside(p[0],p[1])):!inside(g.x,g.y)||(o.tool==='box'&&((g.x as number)+(g.w as number)>size.width||(g.y as number)+(g.h as number)>size.height)))throw new BadRequestException('标注几何超出影像范围');
      }
    }
  }
}
