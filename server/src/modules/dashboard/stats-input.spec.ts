import { describe, expect, it } from 'vitest';
import { parseStats } from './stats-input';
import { metrics } from './stats.service';
describe('stats contracts', () => {
  it('uses Beijing natural days across UTC midnight and includes today in 30 days', () => {
    expect(parseStats({},new Date('2026-10-01T16:00:00Z'))).toMatchObject({from:'2026-09-03',to:'2026-10-02',page:1,pageSize:20,group_by:'task'});
    expect(parseStats({},new Date('2026-10-01T15:59:59Z')).to).toBe('2026-10-01');
    expect(parseStats({from:'2024-02-29',to:'2024-03-01',group_by:'person',page:'2',pageSize:'100'})).toMatchObject({from:'2024-02-29',page:2,pageSize:100,group_by:'person'});
  });
  it.each([{from:'2026-10-01'},{to:'2026-10-01'},{from:'2026-02-30',to:'2026-03-01'},
    {from:'2026-10-02',to:'2026-10-01'},{from:['2026-10-01'],to:'2026-10-02'},
    {from:'0000-01-01',to:'2026-10-02'},{group_by:'reviewer'},{group_by:['task','person']},
    {page:'01'},{pageSize:'101'},{page:'9007199254740991',pageSize:'100'},
    {system_code:'__proto__'},{source:'real'},{task_id:'bad'},{person_id:{}},{extra:'true'}])('rejects ambiguous or invalid query %j', query => expect(()=>parseStats(query)).toThrow());
  it('uses original counts for rates and keeps no denominator distinct from zero percent', () => {
    expect(metrics({completed:0,normal_passed:0,normal_returned:0,normal_total:0,spotcheck_passed:0,spotcheck_returned:0,spotcheck_total:0})).toMatchObject({return_rate:null,spotcheck_pass_rate:null});
    expect(metrics({completed:2,normal_passed:2,normal_returned:1,normal_total:3,spotcheck_passed:1,spotcheck_returned:1,spotcheck_total:2})).toMatchObject({return_rate:1/3,spotcheck_pass_rate:0.5});
  });
});

import {vi} from 'vitest';
import {ForbiddenException,ServiceUnavailableException} from '@nestjs/common';
import {StatsService} from './stats.service';
import type {AuthUser} from '../auth/auth.models';
it('fails closed on stale admin state before aggregate and exposes timeout as retryable unavailability',async()=>{
 const actor:AuthUser={id:'10000000-0000-4000-8000-000000000001',username:'synthetic',real_name:'合成测试',password_hash:'synthetic-unused',
  role:'admin',quals:{},status:'active',expire_at:'2099-12-31',must_change_password:false,mfa_secret_encrypted:'synthetic',updated_at:new Date()};
 const query=vi.fn().mockResolvedValueOnce([{...actor,status:'disabled'}]);
 const db={transaction:(run:(manager:{query:typeof query})=>Promise<unknown>)=>run({query})};const service=new StatsService(db as never);
 await expect(service.read(actor,{})).rejects.toBeInstanceOf(ForbiddenException);expect(query).toHaveBeenCalledTimes(1);
 query.mockReset().mockResolvedValueOnce([actor]).mockResolvedValueOnce([]).mockRejectedValueOnce({code:'57014',message:'private SQL detail'});
 await expect(service.read(actor,{})).rejects.toBeInstanceOf(ServiceUnavailableException);
});
