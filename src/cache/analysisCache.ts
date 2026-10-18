import * as path from 'path';
import * as vscode from 'vscode';
import { ArchitectureModel, detectArchitecture } from '../analyzer/architectureAnalyzer';
import { analyzeAst, AstAnalysis, AstModuleInfo } from '../analyzer/astAnalyzer';
import { analyzeHttp, ApiRoute, HttpAnalysis, HttpRequest } from '../analyzer/httpAnalyzer';
import { analyzeImportsAndExports, FileModuleInfo, ImportExportAnalysis } from '../analyzer/importExportAnalyzer';
import { buildDependencyGraph, DependencyGraph } from '../graph/dependencyGraph';
import { buildRelationshipGraph, RelationshipGraph } from '../graph/relationshipEngine';
import { ProjectFile, ProjectModel } from '../models/projectModel';
import { CONFIG_FILES, IGNORED_DIRECTORIES, LANGUAGE_BY_EXTENSION, scanProject } from '../scanner/projectScanner';

const ANALYZABLE_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs',
    '.html', '.htm', '.css', '.scss', '.sass', '.less'
]);

export interface AnalysisSnapshot {
    project: ProjectModel;
    imports: ImportExportAnalysis;
    ast: AstAnalysis;
    http: HttpAnalysis;
    architecture: ArchitectureModel;
    dependencyGraph: DependencyGraph;
    relationshipGraph: RelationshipGraph;
    updatedAt: number;
}

export interface CacheChangeEvent {
    affectedFiles: string[];
    durationMs: number;
    kind: 'initial' | 'incremental';
}

function isPathIgnored(relativePath: string, extraExclude: string[] = []): boolean {
    const normalized = relativePath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    for (const part of parts) {
        if (IGNORED_DIRECTORIES.has(part) || extraExclude.includes(part)) {
            return true;
        }
    }
    return false;
}

function calculateAstTotals(modules: AstModuleInfo[]): AstAnalysis['totals'] {
    return {
        functions: modules.reduce((sum, m) => sum + m.symbols.filter(s => s.kind === 'function').length, 0),
        classes: modules.reduce((sum, m) => sum + m.symbols.filter(s => s.kind === 'class').length, 0),
        methods: modules.reduce((sum, m) => sum + m.symbols.filter(s => s.kind === 'method').length, 0),
        variables: modules.reduce((sum, m) => sum + m.symbols.filter(s => s.kind === 'variable').length, 0),
        calls: modules.reduce((sum, m) => sum + m.calls.length, 0),
        imports: modules.reduce((sum, m) => sum + m.imports.length, 0),
        exports: modules.reduce((sum, m) => sum + m.exports.length, 0),
        angularComponents: modules.reduce((sum, m) => sum + m.symbols
            .filter(s => s.frameworkRole === 'angular-component').length, 0),
        angularServices: modules.reduce((sum, m) => sum + m.symbols
            .filter(s => s.frameworkRole === 'angular-service').length, 0),
        angularRoutes: modules.reduce((sum, m) => sum + m.frameworkRoutes.length, 0),
        expressControllers: modules.reduce((sum, m) => sum + m.symbols
            .filter(s => s.frameworkRole === 'express-controller').length, 0),
        mongooseModels: modules.reduce((sum, m) => sum + m.symbols
            .filter(s => s.frameworkRole === 'mongoose-model').length, 0)
    };
}

export class AnalysisCache {
    private cachedProject?: ProjectModel;
    private cachedImports = new Map<string, FileModuleInfo>();
    private cachedAst = new Map<string, AstModuleInfo>();
    private cachedHttp = new Map<string, { routes: ApiRoute[]; requests: HttpRequest[] }>();
    private cachedArchitecture?: ArchitectureModel;
    private fileMtimes = new Map<string, number>();

    private cachedSnapshot?: AnalysisSnapshot;
    private isInitialized = false;

    private readonly onDidChangeEmitter = new vscode.EventEmitter<CacheChangeEvent>();
    public readonly onDidChange = this.onDidChangeEmitter.event;

    private pendingUpdates = new Set<string>();
    private debounceTimer?: NodeJS.Timeout;

    public invalidate(): void {
        this.cachedSnapshot = undefined;
        this.cachedProject = undefined;
        this.cachedImports.clear();
        this.cachedAst.clear();
        this.cachedHttp.clear();
        this.cachedArchitecture = undefined;
        this.fileMtimes.clear();
        this.isInitialized = false;
    }

    public async getSnapshot(
        workspaceUri: vscode.Uri,
        forceRescan = false,
        extraExclude: string[] = []
    ): Promise<AnalysisSnapshot> {
        if (!forceRescan && this.cachedSnapshot && this.isInitialized) {
            return this.cachedSnapshot;
        }

        const start = Date.now();
        const project = await scanProject(workspaceUri, extraExclude);
        this.cachedProject = project;

        const filePaths = project.files.map(file => file.relativePath);
        const codeFiles = filePaths.filter(fp => ANALYZABLE_EXTENSIONS.has(path.posix.extname(fp).toLowerCase()));

        const [imports, ast, http, architecture] = await Promise.all([
            analyzeImportsAndExports(workspaceUri, filePaths),
            analyzeAst(workspaceUri, filePaths),
            analyzeHttp(workspaceUri, filePaths),
            detectArchitecture(workspaceUri, project)
        ]);

        this.cachedImports.clear();
        for (const mod of imports.modules) {
            this.cachedImports.set(mod.filePath, mod);
        }

        this.cachedAst.clear();
        for (const mod of ast.modules) {
            this.cachedAst.set(mod.filePath, mod);
        }

        this.cachedHttp.clear();
        for (const req of http.requests) {
            const current = this.cachedHttp.get(req.filePath) ?? { routes: [], requests: [] };
            current.requests.push(req);
            this.cachedHttp.set(req.filePath, current);
        }
        for (const route of http.routes) {
            const current = this.cachedHttp.get(route.filePath) ?? { routes: [], requests: [] };
            current.routes.push(route);
            this.cachedHttp.set(route.filePath, current);
        }

        this.cachedArchitecture = architecture;

        // Populate mtimes for quick change check
        await Promise.all(
            codeFiles.map(async relPath => {
                try {
                    const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(workspaceUri, relPath));
                    this.fileMtimes.set(relPath, stat.mtime);
                } catch {
                    // Ignore missing files
                }
            })
        );

        const dependencyGraph = buildDependencyGraph(imports, filePaths);
        const relationshipGraph = buildRelationshipGraph(ast, dependencyGraph);

        this.cachedSnapshot = {
            project,
            imports,
            ast,
            http,
            architecture,
            dependencyGraph,
            relationshipGraph,
            updatedAt: Date.now()
        };

        this.isInitialized = true;
        this.onDidChangeEmitter.fire({
            affectedFiles: filePaths,
            durationMs: Date.now() - start,
            kind: 'initial'
        });

        return this.cachedSnapshot;
    }

    public queueFileChange(
        workspaceUri: vscode.Uri,
        uri: vscode.Uri,
        extraExclude: string[] = []
    ): void {
        const relativePath = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
        if (isPathIgnored(relativePath, extraExclude)) {
            return;
        }

        this.pendingUpdates.add(relativePath);
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            void this.processPendingUpdates(workspaceUri, extraExclude);
        }, 150);
    }

    private async processPendingUpdates(
        workspaceUri: vscode.Uri,
        extraExclude: string[] = []
    ): Promise<void> {
        if (!this.isInitialized || !this.cachedProject) {
            this.pendingUpdates.clear();
            return;
        }

        const filesToProcess = Array.from(this.pendingUpdates);
        this.pendingUpdates.clear();
        if (filesToProcess.length === 0) {
            return;
        }

        const start = Date.now();
        const codeFilesToAnalyze: string[] = [];
        let configChanged = false;

        for (const relPath of filesToProcess) {
            const fileUri = vscode.Uri.joinPath(workspaceUri, relPath);
            const baseName = path.posix.basename(relPath);
            const ext = path.posix.extname(relPath).toLowerCase();

            if (CONFIG_FILES.has(baseName) || relPath.endsWith('package.json')) {
                configChanged = true;
            }

            try {
                const stat = await vscode.workspace.fs.stat(fileUri);
                const prevMtime = this.fileMtimes.get(relPath);
                if (prevMtime === stat.mtime) {
                    continue; // No content change
                }
                this.fileMtimes.set(relPath, stat.mtime);

                // Update or add in project files list
                const existingIdx = this.cachedProject.files.findIndex(f => f.relativePath === relPath);
                const language = LANGUAGE_BY_EXTENSION[ext] ?? 'Other';
                const fileEntry: ProjectFile = {
                    name: baseName,
                    relativePath: relPath,
                    extension: ext,
                    language,
                    sizeBytes: stat.size
                };

                if (existingIdx >= 0) {
                    this.cachedProject.files[existingIdx] = fileEntry;
                } else {
                    this.cachedProject.files.push(fileEntry);
                    this.cachedProject.totalFiles++;
                }

                if (ANALYZABLE_EXTENSIONS.has(ext)) {
                    codeFilesToAnalyze.push(relPath);
                }
            } catch {
                // File was deleted
                this.fileMtimes.delete(relPath);
                this.cachedImports.delete(relPath);
                this.cachedAst.delete(relPath);
                this.cachedHttp.delete(relPath);

                const existingIdx = this.cachedProject.files.findIndex(f => f.relativePath === relPath);
                if (existingIdx >= 0) {
                    this.cachedProject.files.splice(existingIdx, 1);
                    this.cachedProject.totalFiles = Math.max(0, this.cachedProject.totalFiles - 1);
                }
            }
        }

        // Incrementally analyze only the modified code files
        if (codeFilesToAnalyze.length > 0) {
            const [newImports, newAst, newHttp] = await Promise.all([
                analyzeImportsAndExports(
                    workspaceUri,
                    codeFilesToAnalyze,
                    this.cachedProject.files.map(file => file.relativePath)
                ),
                analyzeAst(workspaceUri, codeFilesToAnalyze),
                analyzeHttp(workspaceUri, codeFilesToAnalyze)
            ]);

            for (const mod of newImports.modules) {
                this.cachedImports.set(mod.filePath, mod);
            }
            for (const mod of newAst.modules) {
                this.cachedAst.set(mod.filePath, mod);
            }
            for (const relPath of codeFilesToAnalyze) {
                this.cachedHttp.delete(relPath);
            }
            for (const req of newHttp.requests) {
                const current = this.cachedHttp.get(req.filePath) ?? { routes: [], requests: [] };
                current.requests.push(req);
                this.cachedHttp.set(req.filePath, current);
            }
            for (const route of newHttp.routes) {
                const current = this.cachedHttp.get(route.filePath) ?? { routes: [], requests: [] };
                current.routes.push(route);
                this.cachedHttp.set(route.filePath, current);
            }
        }

        // Recompute architecture if config changed
        if (configChanged || !this.cachedArchitecture) {
            this.cachedArchitecture = await detectArchitecture(workspaceUri, this.cachedProject);
        }

        // Recalculate project totals & language counts
        const languageCounts: Record<string, number> = {};
        let totalSize = 0;
        for (const file of this.cachedProject.files) {
            totalSize += file.sizeBytes;
            languageCounts[file.language] = (languageCounts[file.language] ?? 0) + 1;
        }
        this.cachedProject.totalSizeBytes = totalSize;
        this.cachedProject.languageCounts = languageCounts;
        this.cachedProject.scannedAt = new Date().toISOString();

        // Rebuild combined data objects in memory
        const allModules = Array.from(this.cachedImports.values());
        const allAstModules = Array.from(this.cachedAst.values());
        const allHttpValues = Array.from(this.cachedHttp.values());

        const importsAnalysis: ImportExportAnalysis = {
            modules: allModules,
            unresolvedImports: []
        };

        const astAnalysis: AstAnalysis = {
            modules: allAstModules,
            totals: calculateAstTotals(allAstModules)
        };

        const httpAnalysis: HttpAnalysis = {
            requests: allHttpValues.flatMap(h => h.requests),
            routes: allHttpValues.flatMap(h => h.routes)
        };

        const filePaths = this.cachedProject.files.map(f => f.relativePath);
        const dependencyGraph = buildDependencyGraph(importsAnalysis, filePaths);
        const relationshipGraph = buildRelationshipGraph(astAnalysis, dependencyGraph);

        this.cachedSnapshot = {
            project: this.cachedProject,
            imports: importsAnalysis,
            ast: astAnalysis,
            http: httpAnalysis,
            architecture: this.cachedArchitecture,
            dependencyGraph,
            relationshipGraph,
            updatedAt: Date.now()
        };

        const durationMs = Date.now() - start;
        this.onDidChangeEmitter.fire({
            affectedFiles: filesToProcess,
            durationMs,
            kind: 'incremental'
        });
    }

    public dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.onDidChangeEmitter.dispose();
    }
}
