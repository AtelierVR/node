export interface FileInfo {
  key: string;
  value: string;
  url: URL;
  created: Date;
  size: number;
  mimetype: string;
  /** Metadata persisted alongside the file (e.g. image dimensions). */
  metadata?: Record<string, unknown>;
}

export interface CreateFile {
  source: string;
  mimetype: string;
  /** Metadata to persist alongside the file (e.g. image dimensions). */
  metadata?: Record<string, unknown>;
}

export interface IStorageProvider {
  init(): Promise<void>;
  delete(key: string): Promise<void>;
  store(file: CreateFile): Promise<FileInfo>;
  get(key: string): Promise<FileInfo>;
}
