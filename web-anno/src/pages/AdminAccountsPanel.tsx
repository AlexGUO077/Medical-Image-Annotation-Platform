import {Alert,Button,Checkbox,Form,Input,Modal,Pagination,Popconfirm,Select,Space,Spin,Table,Typography,theme} from 'antd';
import {useEffect,useState} from 'react';
import type {Qualifications,Session} from '../auth/types';
import {draftAccountId} from '../annotations/drafts';
import {SYSTEM_OPTIONS} from '../cases/types';
import type {Assignee} from '../tasks/api';
import {adminApi,type AccountUpdate,type CreateAccount,type InitialAccount,type Page} from '../admin/api';
import {ViewerRequestError} from '../viewer/api';

function QualificationsEditor({value={},onChange}:{value?:Qualifications;onChange?(next:Qualifications):void}){
 const set=(system:string,capability:'annotate'|'review',enabled:boolean)=>{
  const next={...value};const entries=new Set(next[system]??[]);if(enabled)entries.add(capability);else entries.delete(capability);
  if(entries.size)next[system]=['annotate','review'].filter(x=>entries.has(x as 'annotate'|'review')) as ('annotate'|'review')[];else delete next[system];onChange?.(next);
 };
 return <Table size="small" pagination={false} rowKey="value" dataSource={[...SYSTEM_OPTIONS]} columns={[
  {title:'系统',dataIndex:'label'},
  ...(['annotate','review'] as const).map((capability,index)=>({title:index===0?'标注资格':'审核资格',render:(_:unknown,s:typeof SYSTEM_OPTIONS[number])=><Checkbox aria-label={`${s.label}${index===0?'标注':'审核'}`} checked={value[s.value]?.includes(capability)??false} onChange={e=>set(s.value,capability,e.target.checked)}/> })),
 ]}/>;
}
function qualificationText(quals:Qualifications){return SYSTEM_OPTIONS.flatMap(s=>{const q=quals[s.value]??[];return q.length?[`${s.label}：${q.map(c=>c==='annotate'?'标注':'审核').join('、')}`]:[];}).join('；')||'无资格';}
function sameQualifications(a:Qualifications,b:Qualifications){return SYSTEM_OPTIONS.every(s=>['annotate','review'].every(c=>(a[s.value]?.includes(c as 'annotate'|'review')??false)===(b[s.value]?.includes(c as 'annotate'|'review')??false)));}

export function AdminAccountsPanel({session,onExpired}:{session:Session;onExpired():void}){
 const {token}=theme.useToken();
 const [page,setPage]=useState(1),[revision,setRevision]=useState(0),[data,setData]=useState<Page<Assignee>>(),[error,setError]=useState<string>(),[operationError,setOperationError]=useState<string>(),[notice,setNotice]=useState<string>(),[busy,setBusy]=useState(false);
 const [creating,setCreating]=useState(false),[editing,setEditing]=useState<Assignee>(),[pending,setPending]=useState<{create:CreateAccount}|{update:AccountUpdate}>(),[initial,setInitial]=useState<InitialAccount>();
 const [createForm]=Form.useForm<CreateAccount>(),[editForm]=Form.useForm<{quals:Qualifications;expire_at:string}>();const me=draftAccountId(session.token);
 useEffect(()=>{if(session.role!=='admin')return;const c=new AbortController();setData(undefined);setError(undefined);
  adminApi.users(session.token,page,c.signal).then(r=>{if(!c.signal.aborted)setData(r);}).catch(e=>{if(!c.signal.aborted){setError(e.message);if(e instanceof ViewerRequestError&&[401,403].includes(e.status)){setInitial(undefined);setCreating(false);setEditing(undefined);setPending(undefined);onExpired();}}});return()=>c.abort();
 },[session.token,session.role,page,revision,onExpired]);
 useEffect(()=>{const focus=()=>setRevision(n=>n+1);window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[]);
 if(session.role!=='admin')return <Alert type="error" message="需要管理员权限"/>;
 async function change(input:{create:CreateAccount}|{update:AccountUpdate}){
  if(busy)return;setBusy(true);setOperationError(undefined);setNotice(undefined);
  try{if('create'in input){const result=await adminApi.createUser(session.token,input.create);setInitial(result);setCreating(false);createForm.resetFields();setNotice('账号已开通，请完成本次凭据交接');}
   else{const result=await adminApi.updateUser(session.token,input.update);setEditing(undefined);setNotice(`账号变更已生效，释放 ${result.released_assignments} 个失效分派；旧会话须重新登录`);if(input.update.id===me){setInitial(undefined);onExpired();}}setPending(undefined);
  }catch(e){setOperationError(`${e instanceof Error?e.message:'响应未知'}；请刷新账号或查询审计核对最终状态，不自动重试。`);setPending(undefined);if(e instanceof ViewerRequestError&&[401,403].includes(e.status))onExpired();}
  finally{setBusy(false);setRevision(n=>n+1);}
 }
 const closeCreate=()=>{if(!busy){setCreating(false);createForm.resetFields();}};
 return <><Space direction="vertical" style={{width:'100%'}}>
  <Typography.Title level={2}>账号与资格管理</Typography.Title>
  <Typography.Paragraph>资格按系统授予标注、审核能力。本期录入由管理员执行。停用、到期、资格挂起及认证重置使旧会话失效，并释放不再符合条件的在途分派；启用或恢复资格不会恢复旧分派。</Typography.Paragraph>
  {(error||operationError)&&<Alert type="error" message={error||operationError}/>} {notice&&<Alert type="success" message={notice}/>}
  <Space><Button type="primary" disabled={busy} onClick={()=>{createForm.resetFields();setCreating(true);}}>开通账号</Button><Button disabled={busy} onClick={()=>setRevision(n=>n+1)}>刷新账号</Button></Space>
  {!data&&!error&&<Spin aria-label="加载账号"/>}
  {data&&<><Table rowKey="id" dataSource={data.items} pagination={false} scroll={{x:1100}} columns={[
   {title:'账号',dataIndex:'username'},{title:'姓名',dataIndex:'real_name'}, {title:'角色',dataIndex:'role',render:(v:string)=>v==='admin'?'管理员':'业务人员'},
   {title:'状态',dataIndex:'status',render:(v:string)=>v==='active'?'启用':'停用'}, {title:'有效期',dataIndex:'expire_at'},
   {title:'资格',dataIndex:'quals',render:qualificationText}, {title:'安全设置',render:(_:unknown,u:Assignee)=>u.must_change_password?'须首次改密':u.role==='admin'?(u.mfa_enabled?'2FA 已绑定':'须绑定 2FA'):'已完成'},
   {title:'操作',render:(_:unknown,u:Assignee)=><Space wrap>
    <Button disabled={busy} onClick={()=>{editForm.setFieldsValue({quals:u.quals,expire_at:u.expire_at});setEditing(u);}}>编辑资格与有效期</Button>
    <Popconfirm title={u.status==='active'?'停用账号并使旧会话失效？':'已核实异常，重新启用此账号？'} onConfirm={()=>change({update:{id:u.id,status:u.status==='active'?'disabled':'active'}})}><Button disabled={busy||(u.id===me&&u.status==='active')}>{u.status==='active'?'停用账号':'启用账号'}</Button></Popconfirm>
    {u.role==='admin'&&<Popconfirm title="重置另一管理员的 2FA？其须重新登录并绑定。" onConfirm={()=>change({update:{id:u.id,reset_mfa:true}})}><Button disabled={busy||u.id===me}>重置 2FA</Button></Popconfirm>}
   </Space>},
  ]}/><Pagination current={page} total={data.total} pageSize={20} showSizeChanger={false} onChange={setPage}/></>}
 </Space>
  <Modal title="开通账号" open={creating} footer={null} onCancel={closeCreate} maskClosable={false} destroyOnHidden>
   <Form form={createForm} disabled={busy} layout="vertical" initialValues={{role:'member',quals:{}}} onFinish={values=>setPending({create:values})}>
    <Form.Item name="real_name" label="姓名" rules={[{required:true,whitespace:true,message:'填写姓名'}]}><Input aria-label="新账号姓名" disabled={busy}/></Form.Item>
    <Form.Item name="email" label="邮箱（可选）" rules={[{type:'email',message:'邮箱格式无效'}]}><Input aria-label="新账号邮箱" disabled={busy}/></Form.Item>
    <Form.Item name="phone" label="电话（可选）"><Input aria-label="新账号电话" disabled={busy}/></Form.Item>
    <Form.Item name="role" label="账号角色" rules={[{required:true}]}><Select aria-label="新账号角色" disabled={busy} options={[{value:'member',label:'业务人员'},{value:'admin',label:'管理员（登录须 2FA）'}]}/></Form.Item>
    <Form.Item name="expire_at" label="有效期（必填，无默认期限）" rules={[{required:true,message:'选择有效期'}]}><Input aria-label="新账号有效期" type="date" disabled={busy}/></Form.Item>
    <Form.Item name="quals" label="按系统授予资格"><QualificationsEditor/></Form.Item>
    <Button htmlType="submit" type="primary" disabled={busy}>确认开通</Button>
   </Form>
  </Modal>
  <Modal title={`编辑账号：${editing?.username??''}`} open={!!editing} footer={null} onCancel={()=>{if(!busy)setEditing(undefined);}} maskClosable={false} destroyOnHidden>
   <Form form={editForm} disabled={busy} layout="vertical" onFinish={values=>{if(!editing)return;const update:AccountUpdate={id:editing.id};if(values.expire_at!==editing.expire_at)update.expire_at=values.expire_at;if(!sameQualifications(values.quals,editing.quals))update.quals=values.quals;
    if(Object.keys(update).length===1){setNotice('没有变更');setEditing(undefined);}else setPending({update});}}>
    <Form.Item name="expire_at" label="有效期" rules={[{required:true}]}><Input aria-label="账号有效期" type="date" disabled={busy}/></Form.Item>
    <Form.Item name="quals" label="标注 / 审核资格"><QualificationsEditor/></Form.Item>
    <Button htmlType="submit" type="primary" disabled={busy}>保存账号变更</Button>
   </Form>
  </Modal>
  <Modal title="确认账号操作" zIndex={token.zIndexPopupBase+100} open={!!pending} confirmLoading={busy} onOk={()=>pending&&change(pending)} onCancel={()=>{if(!busy)setPending(undefined);}} maskClosable={false} closable={!busy} cancelButtonProps={{disabled:busy}}>
   {pending&&('create'in pending?<Typography.Paragraph>开通 {pending.create.real_name}（{pending.create.role==='admin'?'管理员':'业务人员'}），有效期 {pending.create.expire_at}；{qualificationText(pending.create.quals)}。初始密码仅本次交接，首次登录须改密。</Typography.Paragraph>:<><Typography.Paragraph>修改 {editing?.username}；旧会话将失效，失去资格的分派自动释放，恢复资格不会恢复旧分派。</Typography.Paragraph>{pending.update.expire_at&&<Typography.Paragraph>有效期：{editing?.expire_at} → {pending.update.expire_at}</Typography.Paragraph>}{pending.update.quals&&<Typography.Paragraph>资格：{qualificationText(editing?.quals??{})} → {qualificationText(pending.update.quals)}</Typography.Paragraph>}</>)}
  </Modal>
  <Modal title="本次账号凭据交接" zIndex={token.zIndexPopupBase+100} open={!!initial} maskClosable={false} onCancel={()=>setInitial(undefined)} footer={<Button onClick={()=>setInitial(undefined)}>已完成交接并清除</Button>} destroyOnHidden>
   <Typography.Paragraph>仅在此成功响应中展示。关闭或离开账号页后无法再查询，账号首次登录必须修改密码；本期不发送邮件或短信。</Typography.Paragraph>
   {initial&&<><Typography.Paragraph>用户名：{initial.username}</Typography.Paragraph><Input.Password aria-label="本次初始密码" value={initial.initial_password} readOnly autoComplete="off"/></>}
  </Modal>
 </>;
}
