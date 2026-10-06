import { Alert, Button, Card, Col, Empty, Form, Input, Pagination, Row, Select, Space, Spin, Statistic, Table, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '../auth/types';
import { IMPORT_SOURCE_OPTIONS, SYSTEM_OPTIONS } from '../cases/types';
import { ViewerRequestError } from '../viewer/api';
import { statsApi } from '../dashboard/api';
import { GROUP_OPTIONS, type Metrics, type StatsOptions, type StatsQuery, type StatsResult } from '../dashboard/types';

export const percent=(value:number|null)=>value===null?'暂无':`${(value*100).toFixed(1)}%`;
function Picker({kind,token,value,onChange,onDenied}:{kind:'task'|'person';token:string;value?:string;onChange(value?:string):void;onDenied():void}) {
  const [page,setPage]=useState(1),[data,setData]=useState<StatsOptions>(),[error,setError]=useState<string>(),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError(undefined);
    statsApi.options(kind,token,page,controller.signal).then(next=>{if(!controller.signal.aborted)setData(previous=>({...next,items:page===1?next.items:[...(previous?.items??[]),...next.items]}));})
      .catch(reason=>{if(!controller.signal.aborted){setError(reason instanceof Error?reason.message:'选项加载失败');if(reason instanceof ViewerRequestError&&[401,403].includes(reason.status))onDenied();}})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[kind,token,page,retry,onDenied]);
  return <Space direction="vertical" size={2}>
    <Select aria-label={kind==='task'?'筛选任务':'筛选提交标注人'} placeholder={kind==='task'?'全部任务':'全部提交标注人'} style={{width:230}} allowClear showSearch optionFilterProp="label" value={value} options={data?.items} loading={loading} onChange={onChange}/>
    {error&&<Space><Typography.Text type="danger">{error}</Typography.Text><Button size="small" onClick={()=>setRetry(n=>n+1)}>重试选项</Button></Space>}
    {data&&data.items.length<data.total&&<Button size="small" disabled={loading||!!error} onClick={()=>setPage(p=>p+1)}>加载更多{kind==='task'?'任务':'人员'}</Button>}
  </Space>;
}
function Trend({data}:{data:StatsResult['trend']}) {
  const maximum=data.reduce((max,row)=>Math.max(max,row.completed),1);
  const x=(i:number)=>36+(data.length<2?0:i/(data.length-1)*700), y=(n:number)=>166-n/maximum*140;
  return <Card title="每日完成量">
    <svg role="img" aria-label="北京时间每日完成量趋势" viewBox="0 0 780 200" style={{width:'100%',maxHeight:250}}>
      <line x1={36} y1={166} x2={736} y2={166} stroke="currentColor"/>
      <text x={8} y={170} fontSize={12}>0</text><text x={8} y={26} fontSize={12}>{maximum}</text>
      <polyline fill="none" stroke="#1677ff" strokeWidth={2} points={data.map((row,i)=>`${x(i)},${y(row.completed)}`).join(' ')}/>
      {data.length===1&&<circle cx={36} cy={y(data[0]!.completed)} r={3} fill="#1677ff"/>}
      <text x={36} y={192} fontSize={12}>{data[0]?.day}</text><text x={736} y={192} textAnchor="end" fontSize={12}>{data.at(-1)?.day}</text>
    </svg>
  </Card>;
}
const columns=[{title:'分组',dataIndex:'label'},{title:'完成版本数',dataIndex:'completed'},
  {title:'普通审核（通过 / 打回 / 总计）',render:(_:unknown,row:Metrics)=>`${row.normal_passed} / ${row.normal_returned} / ${row.normal_total}`},
  {title:'打回率',dataIndex:'return_rate',render:percent},
  {title:'抽检（通过 / 打回 / 总计）',render:(_:unknown,row:Metrics)=>`${row.spotcheck_passed} / ${row.spotcheck_returned} / ${row.spotcheck_total}`},
  {title:'抽检合格率',dataIndex:'spotcheck_pass_rate',render:percent}];
const ignore=()=>{};
export function DashboardPage({session,onExpired=ignore}:{session:Session;onExpired?():void}) {
  const [draft,setDraft]=useState<StatsQuery>({group_by:'task'}),[query,setQuery]=useState<StatsQuery>({page:1,pageSize:20}),[revision,setRevision]=useState(0);
  const [data,setData]=useState<StatsResult>(),[error,setError]=useState<string>(),[loading,setLoading]=useState(false);
  const deny=useCallback(()=>{setData(undefined);setError('访问权限已失效，请重新登录');onExpired();},[onExpired]);
  useEffect(()=>{
    if(session.role!=='admin')return;
    const controller=new AbortController();setData(undefined);setError(undefined);setLoading(true);
    statsApi.read(session.token,query,controller.signal).then(result=>{if(!controller.signal.aborted){setData(result);setDraft(previous=>({...previous,from:previous.from??result.filters.from,to:previous.to??result.filters.to}));}})
      .catch(reason=>{if(!controller.signal.aborted){setError(reason instanceof Error?reason.message:'统计请求失败');if(reason instanceof ViewerRequestError&&[401,403].includes(reason.status))onExpired();}})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[session.token,session.role,query,revision,onExpired]);
  useEffect(()=>{const focus=()=>setRevision(n=>n+1);window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[]);
  if(session.role!=='admin')return <Alert type="error" message="需要管理员权限"/>;
  return <section>
    <Typography.Title level={2}>统计看板</Typography.Title>
    <Typography.Paragraph>仅统计已确认脱敏的合成病例。人员指标归属提交标注人；完成量按普通审核通过版本计，全面复核不重复计入。</Typography.Paragraph>
    <Form layout="inline" onFinish={()=>{
      if((!!draft.from)!=(!!draft.to)||(draft.from&&draft.to&&draft.from>draft.to)){setError('请提供有效的起止日期');setData(undefined);return;}
      setQuery({...draft,from:draft.from||undefined,to:draft.to||undefined,page:1,pageSize:20});setRevision(n=>n+1);
    }} style={{gap:12,marginBottom:16}}>
      <Form.Item label="任务"><Picker kind="task" token={session.token} value={draft.task_id} onChange={task_id=>setDraft(previous=>({...previous,task_id}))} onDenied={deny}/></Form.Item>
      <Form.Item label="提交标注人"><Picker kind="person" token={session.token} value={draft.person_id} onChange={person_id=>setDraft(previous=>({...previous,person_id}))} onDenied={deny}/></Form.Item>
      <Form.Item label="系统"><Select aria-label="筛选统计系统" placeholder="全部系统" style={{width:170}} allowClear options={[...SYSTEM_OPTIONS]} value={draft.system_code} onChange={system_code=>setDraft(previous=>({...previous,system_code}))}/></Form.Item>
      <Form.Item label="来源"><Select aria-label="筛选统计来源" placeholder="全部来源" style={{width:220}} allowClear options={[...IMPORT_SOURCE_OPTIONS]} value={draft.source} onChange={source=>setDraft(previous=>({...previous,source}))}/></Form.Item>
      <Form.Item label="起始日期"><Input aria-label="统计起始日期" type="date" value={draft.from??''} onChange={e=>setDraft(previous=>({...previous,from:e.target.value}))}/></Form.Item>
      <Form.Item label="结束日期"><Input aria-label="统计结束日期" type="date" value={draft.to??''} onChange={e=>setDraft(previous=>({...previous,to:e.target.value}))}/></Form.Item>
      <Form.Item label="分组"><Select aria-label="统计分组" options={[...GROUP_OPTIONS]} style={{width:150}} value={draft.group_by} onChange={group_by=>setDraft(previous=>({...previous,group_by}))}/></Form.Item>
      <Form.Item><Space><Button type="primary" htmlType="submit">查询统计</Button><Button onClick={()=>setRevision(n=>n+1)}>刷新统计</Button></Space></Form.Item>
    </Form>
    {error&&<Alert type="error" showIcon message={error}/>}
    {loading&&<Spin aria-label="加载统计"/>}
    {data&&!error&&!loading&&<Space direction="vertical" size="middle" style={{width:'100%'}}>
      <Typography.Text>北京时间 {data.filters.from} 至 {data.filters.to}（含起止日） · 全部匹配记录的总览</Typography.Text>
      <Row gutter={[16,16]}>
        <Col xs={24} md={8}><Card><Statistic title="完成版本数" value={data.summary.completed}/><Typography.Text type="secondary">普通审核通过 {data.summary.normal_passed} 次</Typography.Text></Card></Col>
        <Col xs={24} md={8}><Card><Statistic title="打回率" value={percent(data.summary.return_rate)}/><Typography.Text type="secondary">{data.summary.normal_returned} / {data.summary.normal_total} 次普通审核</Typography.Text></Card></Col>
        <Col xs={24} md={8}><Card><Statistic title="抽检合格率" value={percent(data.summary.spotcheck_pass_rate)}/><Typography.Text type="secondary">{data.summary.spotcheck_passed} / {data.summary.spotcheck_total} 次已完成抽检</Typography.Text></Card></Col>
      </Row>
      <Trend data={data.trend}/>
      <Card title={`按${GROUP_OPTIONS.find(group=>group.value===data.filters.group_by)?.label}汇总`}>
        <Table rowKey="key" columns={columns} dataSource={data.items} pagination={false} scroll={{x:850}} locale={{emptyText:<Empty description="暂无符合条件的审核结论"/>}}/>
        <Pagination style={{marginTop:16}} current={data.page} pageSize={data.pageSize} total={data.total} showSizeChanger={false} showTotal={total=>`共 ${total} 组`} onChange={page=>setQuery(previous=>({...previous,from:data.filters.from,to:data.filters.to,page}))}/>
      </Card>
    </Space>}
  </section>;
}
