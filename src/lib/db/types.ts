export type SourceStatus = "pending" | "processing" | "ready" | "error";

export interface NotebookRow {
  id: string;
  session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface SourceRow {
  id: string;
  notebook_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  status: SourceStatus;
  error_message: string | null;
  page_count: number | null;
  extracted_chars: number | null;
  created_at: string;
  updated_at: string;
}

export interface ChunkInsert {
  source_id: string;
  notebook_id: string;
  chunk_index: number;
  content: string;
  token_count: number;
  page_start: number | null;
  page_end: number | null;
  section_path: string | null;
  embedding: number[];
}

export interface MatchedChunk {
  id: string;
  source_id: string;
  chunk_index: number;
  content: string;
  page_start: number | null;
  page_end: number | null;
  section_path: string | null;
  similarity: number;
}

export interface Citation {
  marker: number;
  chunk_id: string;
  source_id: string;
  filename: string;
  page_start: number | null;
  page_end: number | null;
  section_path: string | null;
  passage: string;
}

export interface MessageRow {
  id: string;
  notebook_id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  created_at: string;
}
