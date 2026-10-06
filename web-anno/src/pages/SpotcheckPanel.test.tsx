import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SpotcheckPanel } from './SpotcheckPanel';
import { tasksApi } from '../tasks/api';
import { syntheticTask } from '../tasks/fixtures';
import { spotcheckMock } from '../tasks/spotcheck.fixtures';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('confirms one batch, prevents duplicate requests and shows durable pending targets',async()=>{
 let complete!:(value:typeof spotcheckMock)=>void;
 const call=vi.spyOn(tasksApi,'spotchecks').mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
 render(<SpotcheckPanel token="token" task={syntheticTask}/>);
 fireEvent.click(screen.getByRole('button',{name:'发起抽检'}));expect(call).not.toHaveBeenCalled();
 const confirm=await screen.findByRole('button',{name:'确认生成抽检'});fireEvent.click(confirm);fireEvent.click(confirm);
 expect(call).toHaveBeenCalledOnce();expect(confirm).toBeDisabled();complete(spotcheckMock);
 expect(await screen.findByText('本轮候选 11 例，抽中 2 例')).toBeInTheDocument();expect(screen.getByText(/已分派 1 例，待派 1 例/)).toBeInTheDocument();
});
