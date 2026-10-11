import * as vscode from 'vscode';
import * as path from 'path';
import {
    ProjectFile,
    ProjectFolder,
    ProjectModel
} from '../models/projectModel';

const IGNORED_DIRECTORIES = new Set([
    '.git',
    '.svn',
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.next',
    '.nuxt',
    '.venv',
    'venv',
    '__pycache__',
    'out'
]);

const CONFIG_FILES = new Set([
    'package.json',
    'tsconfig.json',
    'jsconfig.json',
    'pyproject.toml',
    'requirements.txt',
    'Pipfile',
    'Cargo.toml',
    'go.mod',
    'pom.xml',
    'build.gradle',
    'composer.json',
    'Gemfile',
    'manage.py',
    'vite.config.js',
    'vite.config.ts'
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript React',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript React',
    '.mjs': 'JavaScript',
    '.cjs': 'JavaScript',
    '.py': 'Python',
    '.java': 'Java',
    '.c': 'C',
    '.h': 'C/C++ Header',
    '.cpp': 'C++',
    '.hpp': 'C++',
    '.cs': 'C#',
    '.php': 'PHP',
    '.dart': 'Dart',
    '.go': 'Go',
    '.rs': 'Rust',
    '.html': 'HTML',
    '.css': 'CSS',
    '.scss': 'SCSS',
    '.json': 'JSON',
    '.md': 'Markdown',
    '.sql': 'SQL',
    '.xml': 'XML',
    '.yaml': 'YAML',
    '.yml': 'YAML',
    '.sh': 'Shell',
    '.bat': 'Batch',
    '.ps1': 'PowerShell'
};

export async function scanProject(
    root: vscode.Uri
): Promise<ProjectModel> {
    const files: ProjectFile[] = [];
    const folders: ProjectFolder[] = [];
    const configFiles: string[] = [];
    const languageCounts: Record<string, number> = {};

    let totalSizeBytes = 0;

    async function walk(directory: vscode.Uri): Promise<void> {
        const entries = await vscode.workspace.fs.readDirectory(
            directory
        );

        for (const [name, type] of entries) {
            if (type === vscode.FileType.SymbolicLink) {
                continue;
            }

            if (
                type === vscode.FileType.Directory &&
                IGNORED_DIRECTORIES.has(name)
            ) {
                continue;
            }

            const uri = vscode.Uri.joinPath(directory, name);
            const relativePath = path.posix.relative(
                root.path,
                uri.path
            );

            if (type === vscode.FileType.Directory) {
                folders.push({
                    name,
                    relativePath
                });

                await walk(uri);
                continue;
            }

            if (type !== vscode.FileType.File) {
                continue;
            }

            const extension = path.posix.extname(name).toLowerCase();
            const language =
                LANGUAGE_BY_EXTENSION[extension] ?? 'Other';

            let sizeBytes = 0;

            try {
                const stat = await vscode.workspace.fs.stat(uri);
                sizeBytes = stat.size;
            } catch {
                // Skip size if the file cannot be accessed.
            }

            files.push({
                name,
                relativePath,
                extension,
                language,
                sizeBytes
            });

            totalSizeBytes += sizeBytes;
            languageCounts[language] =
                (languageCounts[language] ?? 0) + 1;

            if (CONFIG_FILES.has(name)) {
                configFiles.push(relativePath);
            }
        }
    }

    await walk(root);

    files.sort((a, b) =>
        a.relativePath.localeCompare(b.relativePath)
    );

    folders.sort((a, b) =>
        a.relativePath.localeCompare(b.relativePath)
    );

    return {
        name: path.posix.basename(root.path) || 'Project',
        rootPath: root.fsPath,
        files,
        folders,
        totalFiles: files.length,
        totalFolders: folders.length,
        totalSizeBytes,
        languageCounts,
        configFiles: configFiles.sort(),
        scannedAt: new Date().toISOString()
    };
}
