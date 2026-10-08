import {Space,Tabs} from 'antd';
import {Link} from 'react-router-dom';
import type {Session} from '../auth/types';
import {AdminTaxonomyPage} from './AdminTaxonomyPage';
import {ExportsPanel} from './ExportsPanel';
import {AuditPanel} from './AuditPanel';
import {AccountUnlockPanel} from './AccountUnlockPanel';
import {AdminAccountsPanel} from './AdminAccountsPanel';
export function AdminPage({session,onExpired}:{session:Session;onExpired():void}){
 return <><Space wrap style={{marginBottom:16}}><Link to="/tasks">任务管理</Link><Link to="/cases/import">病例录入</Link><Link to="/dashboard">统计看板</Link></Space><Tabs destroyOnHidden items={[{key:'taxonomy',label:'标签管理',children:<AdminTaxonomyPage session={session}/>},
  {key:'accounts',label:'账号与资格',children:<AdminAccountsPanel session={session} onExpired={onExpired}/>},
  {key:'exports',label:'导出审批',children:<ExportsPanel session={session} onExpired={onExpired}/>},
  {key:'audit',label:'审计日志',children:<AuditPanel session={session} onExpired={onExpired}/>},
  {key:'unlock',label:'异常账号',children:<AccountUnlockPanel session={session} onExpired={onExpired}/>}]} /></>;
}
