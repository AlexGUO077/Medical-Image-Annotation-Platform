import { Alert, Button, Card, Form, Input } from 'antd';
import { useState } from 'react';
import type { Session } from '../auth/types';
import { authApi } from '../auth/api';
export function StudentAccountPage({session,onChanged}:{session:Session;onChanged():void}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <Card title="修改密码" style={{maxWidth:520}}>{error&&<Alert type="error" message={error}/>}<Form layout="vertical" onFinish={async(v:{current:string;next:string;confirm:string})=>{setError('');if(v.next!==v.confirm){setError('两次输入的新密码不一致');return;}setBusy(true);try{await authApi.changePassword(session.token,v.current,v.next);onChanged();}catch(e){setError(e instanceof Error?e.message:'修改失败');}finally{setBusy(false);}}}>
 <Form.Item label="当前密码" name="current" rules={[{required:true}]}><Input.Password autoComplete="current-password"/></Form.Item><Form.Item label="新密码" name="next" extra="至少12位，包含字母和数字" rules={[{required:true,min:12,max:128}]}><Input.Password autoComplete="new-password"/></Form.Item><Form.Item label="确认新密码" name="confirm" rules={[{required:true}]}><Input.Password autoComplete="new-password"/></Form.Item><Button htmlType="submit" type="primary" loading={busy}>保存并重新登录</Button></Form></Card>;
}
