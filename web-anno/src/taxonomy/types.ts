export interface SignTag {
  id: string;
  name: string;
  system_code: string;
  definition: string;
}

export interface TaxonomyNode {
  id: string;
  parent_id: string | null;
  level: 1 | 2 | 3 | 4;
  name: string;
  synonyms: string[];
  icd: string | null;
  children: TaxonomyNode[];
  sign_tags?: SignTag[];
}

export interface TaxonomyTreeResponse {
  tree: TaxonomyNode[];
  sign_tags: SignTag[];
}
