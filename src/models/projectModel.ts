
export interface ProjectFile {
    name: string;
    relativePath: string;
    extension: string;
    language: string;
    sizeBytes: number;
}

export interface ProjectFolder {
    name: string;
    relativePath: string;
}

export interface ProjectModel {
    name: string;
    rootPath: string;
    files: ProjectFile[];
    folders: ProjectFolder[];
    totalFiles: number;
    totalFolders: number;
    totalSizeBytes: number;
    languageCounts: Record<string, number>;
    configFiles: string[];
    scannedAt: string;
}
