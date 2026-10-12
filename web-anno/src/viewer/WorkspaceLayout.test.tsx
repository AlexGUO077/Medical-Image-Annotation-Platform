import {useState} from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {WorkspaceLayout} from './WorkspaceLayout';
let resized: (entries: {contentRect:{width:number}}[])=>void;
beforeEach(()=>{localStorage.clear();vi.stubGlobal('ResizeObserver',class{constructor(callback:typeof resized){resized=callback;}observe(){}disconnect(){}});});
afterEach(()=>vi.unstubAllGlobals());
function Harness(){const [focus,setFocus]=useState(false);return <WorkspaceLayout focus={focus} onFocus={setFocus} left={<input aria-label="报告筛选"/>} right={<textarea aria-label="未保存批注"/>}><div>影像视口</div></WorkspaceLayout>;}
it('retains field state across independent collapse and focus mode',()=>{
 render(<Harness/>);
 fireEvent.change(screen.getByLabelText('未保存批注'),{target:{value:'合成批注待保存'}});
 fireEvent.click(screen.getByRole('button',{name:'收起右侧栏'}));
 expect(screen.getByLabelText('未保存批注')).not.toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'影像专注模式'}));
 expect(screen.getByLabelText('报告筛选')).not.toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'退出专注模式'}));
 expect(screen.getByLabelText('报告筛选')).toBeVisible();
 expect(screen.getByLabelText('未保存批注')).not.toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'展开右侧栏'}));
 expect(screen.getByLabelText('未保存批注')).toHaveValue('合成批注待保存');
});
it('bounds persisted widths and makes either panel accessible on a narrow desktop',()=>{
 localStorage.setItem('miap.workspace.widths',JSON.stringify({left:900,right:0,unrelated:'discard'}));
 render(<Harness/>);
 const divider=screen.getByRole('separator',{name:'调整左侧栏宽度'});
 expect(divider).toHaveAttribute('aria-valuenow','420');
 fireEvent.keyDown(divider,{key:'ArrowLeft'});
 expect(JSON.parse(localStorage.getItem('miap.workspace.widths')!)).toEqual({left:404,right:300});
 act(()=>resized([{contentRect:{width:1200}}]));
 expect(screen.getByLabelText('报告筛选')).not.toBeVisible();
 expect(screen.getByLabelText('未保存批注')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'展开左侧栏'}));
 expect(screen.getByLabelText('报告筛选')).toBeVisible();
 expect(screen.getByLabelText('未保存批注')).not.toBeVisible();
});
