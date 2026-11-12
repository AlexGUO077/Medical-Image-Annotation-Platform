import type { CaseReferenceSections, EducationFeedback, EducationTask, EducationWorkbench, RosterEntry, StudentAnswer } from './types';
export class EducationError extends Error {constructor(public status:number,message:string){super(message);}}
async function request<T>(path:string,token:string|undefined,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
  const response=await fetch(`/api/education${path}`,{method,signal,cache:'no-store',redirect:'error',headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.headers.get('content-type')?.includes('application/json'))throw new EducationError(response.status,'服务响应无效');
  const value=await response.json();if(!response.ok)throw new EducationError(response.status,value.message??'教学请求失败');return value as T;
}
export const educationApi={
  activate:(student_no:string,activation_code:string,password:string)=>request<{username:string}>('/activate',undefined,'POST',{student_no,activation_code,password}),
  roster:(token:string,page=1)=>request<RosterEntry[]>(`/roster?page=${page}`,token),
  createRoster:(token:string,body:{student_no:string;real_name:string;class_name:string;expire_at:string})=>request<{id:string;activation_code:string}>('/roster',token,'POST',body),
  reissue:(token:string,id:string)=>request<{id:string;activation_code:string}>(`/roster/${id}/activation`,token,'POST',{}),
  candidates:(token:string,page=1)=>request<{id:string;case_no:string;source:string;status:string}[]>(`/candidates?page=${page}`,token),
  tasks:(token:string,page=1)=>request<EducationTask[]>(`/tasks?page=${page}`,token),
  createTask:(token:string,body:{title:string;instructions:string;case_ids:string[];roster_ids:string[];reference_sections:CaseReferenceSections[]})=>request<{id:string}>('/tasks',token,'POST',body),
  taskState:(token:string,id:string,status:'closed'|'revoked')=>request(`/tasks/${id}`,token,'PATCH',{status}),
  submissions:(token:string,id:string,page=1)=>request<{id:string;student_no:string;real_name:string;ordinal:number;answer:StudentAnswer;submitted_at:string}[]>(`/tasks/${id}/submissions?page=${page}`,token),
  start:(token:string,id:string)=>request<{id:string}>(`/items/${id}/attempts`,token,'POST',{}),
  workbench:(token:string,id:string,signal:AbortSignal)=>request<EducationWorkbench>(`/attempts/${id}/workbench`,token,'GET',undefined,signal),
  feedback:(token:string,id:string,signal:AbortSignal)=>request<EducationFeedback>(`/attempts/${id}/feedback`,token,'GET',undefined,signal),
  save:(token:string,id:string,version:number,answer:StudentAnswer)=>request<{version:number}>(`/attempts/${id}/draft`,token,'PUT',{expected_version:version,answer}),
  submit:(token:string,id:string,version:number)=>request(`/attempts/${id}/submit`,token,'POST',{expected_version:version}),
};
