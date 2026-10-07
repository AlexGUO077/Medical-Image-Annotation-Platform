import {BadRequestException,ForbiddenException,UnauthorizedException} from '@nestjs/common';
import type {EntityManager} from 'typeorm';
import type {AuthUser} from '../auth/auth.models';
import {accountAvailable} from '../tasks/assignment-release';
export function pageInput(q:Record<string,unknown>,extra:string[]=[]){
 if(Object.keys(q).some(k=>!['page','pageSize',...extra].includes(k)))throw new BadRequestException('查询参数无效');
 const int=(v:unknown,d:number)=>{if(v===undefined)return d;if(typeof v!=='string'||!/^[1-9]\d*$/.test(v)||!Number.isSafeInteger(Number(v)))throw new BadRequestException('分页无效');return Number(v);};
 const page=int(q.page,1),pageSize=int(q.pageSize,20);if(pageSize>100||!Number.isSafeInteger((page-1)*pageSize))throw new BadRequestException('分页无效');return {page,pageSize};
}
export async function lockAdmins(m:EntityManager,actor:AuthUser,ids:string[]=[]){
 const rows=await m.query('SELECT *,expire_at::text FROM users WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY id FOR SHARE',[[...new Set([actor.id,...ids])]]) as AuthUser[];
 const current=rows.find(u=>u.id===actor.id);if(!current||current.updated_at.getTime()!==actor.updated_at.getTime())throw new UnauthorizedException('会话已失效');
 if([actor.id,...ids].some(id=>{const u=rows.find(u=>u.id===id);return !u||u.role!=='admin'||!accountAvailable(u);}))throw new ForbiddenException('管理员账号不可用');return rows;
}
