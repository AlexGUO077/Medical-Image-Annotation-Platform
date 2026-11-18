import { Alert, Button, Card, Empty } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '../auth/types';
import { ViewerIcon } from '../viewer/ViewerIcon';
import { educationApi, EducationError } from './api';
import type { EducationTask } from './types';

export function StudentTasksPage({ session, onExpired }: { session: Session; onExpired(): void }) {
  const [tasks, setTasks] = useState<EducationTask[]>([]);
  const [page, setPage] = useState(1), [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true), [opening, setOpening] = useState<string>();
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : '加载失败');
    if (e instanceof EducationError && e.status === 401) onExpired();
  };
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setHasNext(false);
    async function load() {
      const result = await educationApi.tasks(session.token, page);
      if (!active) return;
      setTasks(result);
      if (result.length === 50) {
        const next = await educationApi.tasks(session.token, page + 1);
        if (active) setHasNext(next.length > 0);
      }
    }
    load().catch(e => { if (active) fail(e); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session.token, page]);

  async function open(item: EducationTask['items'][number]) {
    if (opening) return;
    setOpening(item.id);
    setError('');
    try {
      const attempt = item.attempt_id ? { id: item.attempt_id } : await educationApi.start(session.token, item.id);
      navigate(`/student/attempts/${attempt.id}${item.state === 'submitted' ? '/feedback' : ''}`);
    } catch (e) { fail(e); }
    finally { setOpening(undefined); }
  }

  return <section className="student-tasks">
    <header className="student-tasks-heading">
      <h1>我的考核</h1><p>独立阅片并完成报告，交卷后可对照医生所见与参考标注。</p>
    </header>
    {error && <Alert type="error" message={error}/>}
    <div className="student-assessments" aria-busy={loading}>
      {loading ? <Card loading/> : tasks.length === 0 ? <Empty description="暂无已分配的考核"/> : tasks.map(task => {
        const submitted = task.items.filter(item => item.state === 'submitted').length;
        return <article className="student-assessment" key={task.id}>
          <header><span className="assessment-icon"><ViewerIcon name="layers"/></span><h2>{task.title}</h2>
            <span className="assessment-state" data-active={task.status === 'published'}>{task.status === 'published' ? '进行中' : '已关闭'}</span>
          </header>
          <div className="assessment-body">
            {task.instructions && <p>{task.instructions}</p>}
            <div className="assessment-progress"><span>已提交 {submitted} / {task.items.length} 题</span></div>
            <div className="assessment-questions">{task.items.map(item => {
              const action = item.state === 'submitted' ? '查看对照' : item.attempt_id ? '继续作答' : '开始作答';
              return <button type="button" key={item.id} className="assessment-question" data-state={item.state ?? 'new'}
                aria-label={`第 ${item.ordinal} 题 · ${action}`} aria-busy={opening === item.id}
                disabled={!!opening || (task.status !== 'published' && item.state !== 'submitted')} onClick={() => void open(item)}>
                <strong>第 {item.ordinal} 题</strong><span>{action}</span><ViewerIcon name="right"/>
              </button>;
            })}</div>
          </div>
        </article>;
      })}
    </div>
    <nav className="student-pagination" aria-label="考核分页">
      <Button disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}>上一页</Button>
      <span aria-current="page">第 {page} 页</span>
      <Button disabled={!hasNext || loading} onClick={() => setPage(p => p + 1)}>下一页</Button>
    </nav>
  </section>;
}
