export interface FileInfo {
    key: string;
    value: string;
    url: URL;
    created: Date;
    size: number;
    mimetype: string;
};

export interface CreateFile {
    source: string;
    mimetype: string;
}

export interface IStorageProvider {
    init(): Promise<void>;
    delete(key: string): Promise<void>;
    store(file: CreateFile): Promise<FileInfo>;
    get(key: string): Promise<FileInfo>;
}
