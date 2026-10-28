export interface InstructionEntry {
  id: string;
  title: string;
  description: string;
  category: string;
  source: string;
  keywords: string[];
}

export interface InstructionSearchResult {
  query: string;
  entries: InstructionEntry[];
  guidance: string;
}

export interface InstructionPage {
  id: string;
  title: string;
  content: string;
  offset: number;
  nextOffset: number | null;
  totalCharacters: number;
}

export interface InstructionToolNames {
  search: string;
  read: string;
}
