import type { Workbench, Series } from '../viewer/api';
import type { Annotation } from '../annotations/types';
export interface LibraryItem {
 id:string;case_no:string;system_code:string;source:string;version:number;
 disease:{id:string;name:string}|null;signs:{id:string;name:string}[];modalities:string[];
 thumbnail:(Series&{frame_index:number})|null;
}
export interface SearchResult {items:LibraryItem[];page:number;pageSize:number;total:number}
export interface LibraryData extends Workbench {
 version:number;current_version:number;annotations:Annotation[];
 disease:LibraryItem['disease'];teaching_fields:Record<string,unknown>|null;
}
export interface SearchFilters {system_code?:string;part_id?:string;disease_id?:string;sign_tag_id?:string;modality?:string;source?:string;q?:string;page?:number;pageSize?:number}
