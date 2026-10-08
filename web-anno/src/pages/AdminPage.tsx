import {Tabs} from 'antd';
import type {Session} from '../auth/types';
import {AdminTaxonomyPage} from './AdminTaxonomyPage';
import {ExportsPanel} from './ExportsPanel';
import {AuditPanel} from './AuditPanel';
import {AccountUnlockPanel} from './AccountUnlockPanel';
export function AdminPage({session,onExpired}:{session:Session;onExpired():void}){
 return <Tabs destroyOnHidden items={[{key:'taxonomy',label:'标签管理',children:<AdminTaxonomyPage session={session}/>},
  {key:'exports',label:'导出审批',children:<ExportsPanel session={session} onExpired={onExpired}/>},
  {key:'audit',label:'审计日志',children:<AuditPanel session={session} onExpired={onExpired}/>},
  {key:'unlock',label:'异常账号',children:<AccountUnlockPanel session={session} onExpired={onExpired}/>}]} />;
}
