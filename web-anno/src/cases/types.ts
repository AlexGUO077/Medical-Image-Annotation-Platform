export const SYSTEM_OPTIONS = [
  { value: 'cns', label: '中枢神经系统' },
  { value: 'headneck', label: '头颈' },
  { value: 'resp', label: '呼吸' },
  { value: 'circ', label: '循环' },
  { value: 'digest', label: '消化' },
  { value: 'uro', label: '泌尿' },
  { value: 'repro', label: '生殖' },
  { value: 'bone', label: '骨骼' },
] as const;

export const CONFIRM_METHODS = ['病理证实', '随访确诊', '临床综合诊断'] as const;

export type SystemCode = typeof SYSTEM_OPTIONS[number]['value'];
export type ConfirmMethod = typeof CONFIRM_METHODS[number];
export type BatchStatus = 'queued' | 'processing' | 'awaiting_confirmation' | 'completed' | 'completed_with_failures' | 'failed';
export type ItemStatus = 'queued' | 'processing' | 'awaiting_confirmation' | 'completed' | 'duplicate' | 'failed';

export interface ImportFailure {
  code: string;
  message: string;
}

export interface OcrHit {
  text: string;
  confidence: number;
  box: number[][];
}

export interface ImportReview {
  masked_report: string | null;
  masked_count: number;
  ocr_hits: OcrHit[];
  ocr_failed: boolean;
  suggested_system_code: SystemCode | null;
  classification_confidence: number;
}

export interface ImportProgressItem {
  item_id: string;
  display_name: string;
  status: ItemStatus;
  stage: string;
  failure: ImportFailure | null;
  review: ImportReview | null;
  case_id: string | null;
}

export interface ImportProgress {
  batch_id: string;
  source: string;
  status: BatchStatus;
  stage: string;
  counts: Record<ItemStatus | 'total', number>;
  items: ImportProgressItem[];
}

export interface ImportAccepted {
  batch_id: string;
  status: 'queued';
  source: string;
}

export interface ConfirmImportInput {
  confirmed: true;
  system_code: SystemCode;
  confirm_method: ConfirmMethod;
}

export interface ConfirmImportResponse {
  batch_id: string;
  item_id: string;
  case_id: string;
  status: 'completed';
  case_status: '已录入';
}
