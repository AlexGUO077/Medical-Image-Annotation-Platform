// Synthetic interface mocks fixed before page integration (Word §1.3).
export const spotcheckMock = {batch_id:'30000000-0000-4000-8000-000000000001',candidate_count:11,sampled_count:2,assigned_count:1,pending_count:1};
export const qualityContextMock = {review_kind:'spotcheck' as const,review_version:3,assignment_id:'40000000-0000-4000-8000-000000000001',started_at:'2026-10-02T13:00:00Z'};
export const qualityFailureMock = {review_id:'50000000-0000-4000-8000-000000000001',case_id:'20000000-0000-4000-8000-000000000001',version:3,status:'已下线' as const,is_gold:true,reannotation:null,review_kind:'spotcheck' as const,assigned_count:0,pending_count:10};
