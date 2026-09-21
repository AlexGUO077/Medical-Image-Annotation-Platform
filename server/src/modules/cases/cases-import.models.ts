export const SYSTEM_CODES = ['cns', 'headneck', 'resp', 'circ', 'digest', 'uro', 'repro', 'bone'] as const;
export const CONFIRM_METHODS = ['病理证实', '随访确诊', '临床综合诊断'] as const;

export type SystemCode = typeof SYSTEM_CODES[number];
export type ConfirmMethod = typeof CONFIRM_METHODS[number];
export type BatchStatus = 'queued' | 'processing' | 'awaiting_confirmation' | 'completed' | 'completed_with_failures' | 'failed';
export type ItemStatus = 'queued' | 'processing' | 'awaiting_confirmation' | 'completed' | 'duplicate' | 'failed';

export interface SourceRecord {
  source: 'synthetic';
  scope: 'development_test_only';
  real_data_allowed: false;
  decision: 'D-31';
  recorded_by: string;
  recorded_at: string;
}

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

export interface ProcessedSeries {
  modality: string;
  series_uid: string;
  frame_count: number;
  default_window: Record<string, unknown> | null;
  dicom_paths: string[];
}

export interface ProcessedCase {
  study_uid: string;
  study_date: string;
  series: ProcessedSeries[];
  masked_report_path: string | null;
  mask_map_path: string | null;
  preview_path: string;
}

export interface ImportItem {
  item_id: string;
  display_name: string;
  quarantine_path: string;
  status: ItemStatus;
  stage: string;
  failure: ImportFailure | null;
  review: ImportReview | null;
  processed: ProcessedCase | null;
  case_id: string | null;
}

export interface ImportBatch {
  batch_id: string;
  source: 'synthetic';
  source_record: SourceRecord;
  actor_id: string;
  request_ip: string;
  quarantine_path: string;
  status: BatchStatus;
  stage: string;
  created_at: string;
  updated_at: string;
  items: ImportItem[];
}

export interface ZipInspectionItem {
  display_name: string;
  path: string;
}

export interface ZipInspectionResult {
  compressed_size: number;
  expanded_size: number;
  file_count: number;
  items: ZipInspectionItem[];
}

export interface CaseProcessingResult {
  review: ImportReview;
  processed: ProcessedCase;
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
  source: 'synthetic';
  status: BatchStatus;
  stage: string;
  counts: Record<ItemStatus | 'total', number>;
  items: ImportProgressItem[];
}

export interface QueueMessage {
  batch_id: string;
  item_id: string;
}
