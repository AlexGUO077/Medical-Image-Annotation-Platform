import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {ReviewFeedback} from './ReviewFeedback';
import type {Annotation} from '../annotations/types';
it('locates stable surviving objects and marks deleted objects as historical',()=>{
 const selected=vi.fn();render(<ReviewFeedback onSelect={selected} annotations={[{id:'current'} as Annotation]} review={{id:'r',reviewer_id:'reviewer',result:'打回',created_at:'2026-10-02T10:00:00Z',is_spotcheck:false,comments:['current','removed'].map(annotation_id=>({kind:'object',annotation_id,text:`修改 ${annotation_id}`,reviewer_id:'reviewer',created_at:'2026-10-02T10:00:00Z',annotation_version:1}))}}/>);
 fireEvent.click(screen.getByRole('button',{name:'定位对象与报告'}));expect(selected).toHaveBeenCalledWith('current');expect(screen.getByText('（历史对象，当前版本已不存在）')).toBeInTheDocument();expect(screen.getAllByRole('button')).toHaveLength(1);
});
