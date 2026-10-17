import { analyzeImportsAndExports } from './analyzer/importExportAnalyzer';
import { buildDependencyGraph } from './graph/dependencyGraph';
import * as vscode from 'vscode';
import { scanProject } from './scanner/projectScanner';
import { showArchitecturePanel } from './providers/architecturePanel';
import { ProjectTreeProvider } from './providers/projectTreeProvider';
import { analyzeAst } from './analyzer/astAnalyzer';
import {
    buildRelationshipGraph,
    getSymbolRelationships
} from './graph/relationshipEngine';
import { showRelationshipPanel } from './providers/relationshipPanel';
import { analyzeImpact } from './graph/impactAnalyzer';
import { showImpactPanel } from './providers/impactPanel';
import { detectArchitecture } from './analyzer/architectureAnalyzer';
import { showArchitectureDetectionPanel } from './providers/architectureDetectionPanel';
import { traceFlow } from './graph/flowAnalyzer';
import { showFlowPanel } from './providers/flowPanel';
import { analyzeHttp } from './analyzer/httpAnalyzer';
import { DashboardData, refreshActiveDashboard, showDashboard } from './providers/dashboardPanel';
import { AnalysisCache } from './cache/analysisCache';

const analysisCache = new AnalysisCache();

function getDevLensConfig(): { exclude: string[]; traceMaxDepth: number; enableFileWatching: boolean } {
    const cfg = vscode.workspace.getConfiguration('devlens');
    return {
        exclude: cfg.get<string[]>('exclude', []),
        traceMaxDepth: cfg.get<number>('traceMaxDepth', 8),
        enableFileWatching: cfg.get<boolean>('enableFileWatching', true)
    };
}

async function loadDashboardData(workspaceUri: vscode.Uri): Promise<DashboardData> {
    const snapshot = await analysisCache.getSnapshot(workspaceUri, false, getDevLensConfig().exclude);
    return {
        project: snapshot.project,
        ast: snapshot.ast,
        graph: snapshot.dependencyGraph,
        architecture: snapshot.architecture
    };
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(analysisCache);
    const projectTreeProvider = new ProjectTreeProvider();

const projectTreeView = vscode.window.createTreeView(
    'devlens.projectView',
    { treeDataProvider: projectTreeProvider }
);

context.subscriptions.push(projectTreeView, projectTreeProvider);

// Status bar indicator for cache state & quick sync feedback
const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
statusBarItem.text = '$(eye) DevLens';
statusBarItem.tooltip = 'DevLens Code Intelligence (Incremental Cache Active)';
statusBarItem.command = 'devlens.openDashboard';
statusBarItem.show();
context.subscriptions.push(statusBarItem);

context.subscriptions.push(
    analysisCache.onDidChange(event => {
        if (event.kind === 'incremental') {
            statusBarItem.text = `$(check) DevLens (${event.durationMs}ms)`;
            setTimeout(() => {
                statusBarItem.text = '$(eye) DevLens';
            }, 2500);
            refreshActiveDashboard();
            projectTreeProvider.refresh();
        } else {
            statusBarItem.text = `$(eye) DevLens (${event.affectedFiles.length} files)`;
            setTimeout(() => {
                statusBarItem.text = '$(eye) DevLens';
            }, 3000);
        }
    })
);

// Incremental file watching on save and file system events
const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
if (workspaceFolder) {
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (!getDevLensConfig().enableFileWatching) {
                return;
            }
            analysisCache.queueFileChange(workspaceFolder.uri, doc.uri, getDevLensConfig().exclude);
        })
    );

    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    context.subscriptions.push(watcher);
    watcher.onDidChange(uri => {
        if (!getDevLensConfig().enableFileWatching) {
            return;
        }
        analysisCache.queueFileChange(workspaceFolder.uri, uri, getDevLensConfig().exclude);
    });
    watcher.onDidCreate(uri => {
        if (!getDevLensConfig().enableFileWatching) {
            return;
        }
        analysisCache.queueFileChange(workspaceFolder.uri, uri, getDevLensConfig().exclude);
    });
    watcher.onDidDelete(uri => {
        if (!getDevLensConfig().enableFileWatching) {
            return;
        }
        analysisCache.queueFileChange(workspaceFolder.uri, uri, getDevLensConfig().exclude);
    });

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('devlens')) {
                analysisCache.invalidate();
            }
        })
    );
}

context.subscriptions.push(
    projectTreeView.onDidChangeVisibility(event => {
        if (event.visible) {
            void vscode.commands.executeCommand('devlens.openDashboard');
        }
    })
);

const refreshDashboard = vscode.commands.registerCommand(
    'devlens.refreshDashboard',
    () => {
        projectTreeProvider.refresh();
        refreshActiveDashboard();
    }
);

context.subscriptions.push(refreshDashboard);

const openDashboard = vscode.commands.registerCommand(
    'devlens.openDashboard',
    async () => {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            vscode.window.showWarningMessage('DevLens: Open a project folder first.');
            return;
        }
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'DevLens: Loading project dashboard...',
                    cancellable: false
                },
                () => showDashboard(
                    workspace.uri,
                    context.extensionUri,
                    () => loadDashboardData(workspace.uri)
                )
            );
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`DevLens dashboard failed to load: ${details}`);
        }
    }
);

context.subscriptions.push(openDashboard);
    const analyzeProject = vscode.commands.registerCommand(
        'devlens.analyzeProject',
        async () => {
            const workspace = vscode.workspace.workspaceFolders?.[0];

            if (!workspace) {
                vscode.window.showWarningMessage(
                    'DevLens: Open a project folder first.'
                );
                return;

            }

            try {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'DevLens: Scanning project...',
                        cancellable: false
                    },
                    async () => {
                    const snapshot = await analysisCache.getSnapshot(workspace.uri, true, getDevLensConfig().exclude);
                    const project = snapshot.project;
                        
                        const languages = Object.entries(
                            project.languageCounts
                        )
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 5)
                            .map(([name, count]) =>
                                `${name}: ${count}`
                            )
                            .join(', ') || 'None detected';

                        const summary = [
                            `Project: ${project.name}`,
                            `Files: ${project.totalFiles}`,
                            `Folders: ${project.totalFolders}`,
                            `Total size: ${(
                                project.totalSizeBytes / 1024
                            ).toFixed(1)} KB`,
                            `Languages: ${languages}`,
                            `Configuration files: ${project.configFiles.length}`
                        ].join('\n');

                        const action =
                            await vscode.window.showInformationMessage(
                                'DevLens scan completed.',
                                'Show Summary'
                            );

                        if (action === 'Show Summary') {
                            vscode.window.showInformationMessage(
                                summary,
                                { modal: true }
                            );
                        }

                        console.log(
                            '[DevLens] Project model:',
                            project
                        );
                        
const analysis = await analyzeImportsAndExports(
    workspace.uri,
    project.files.map(file => file.relativePath)
);

const graph = buildDependencyGraph(
    analysis,
    project.files.map(file => file.relativePath)
);

const ast = await analyzeAst(
    workspace.uri,
    project.files.map(file => file.relativePath)
);

const astSummary = [
    `Functions: ${ast.totals.functions}`,
    `Classes: ${ast.totals.classes}`,
    `Methods: ${ast.totals.methods}`,
    `Variables: ${ast.totals.variables}`,
    `Function calls: ${ast.totals.calls}`,
    `Imports: ${ast.totals.imports}`,
    `Exports: ${ast.totals.exports}`,
    `Angular components: ${ast.totals.angularComponents}`,
    `Angular services: ${ast.totals.angularServices}`,
    `Angular routes: ${ast.totals.angularRoutes}`,
    `Express controllers: ${ast.totals.expressControllers}`,
    `Mongoose models: ${ast.totals.mongooseModels}`
].join('\n');

const astAction = await vscode.window.showInformationMessage(
    'DevLens: AST analysis completed.',
    'Show Summary'
);

if (astAction === 'Show Summary') {
    vscode.window.showInformationMessage(astSummary, { modal: true });
}

const message = [
    `Files analyzed: ${analysis.modules.length}`,
    `Local dependencies: ${graph.edges.length}`,
    `Unresolved local imports: ${analysis.unresolvedImports.length}`
].join('\n');

const importAnalysisAction =
    await vscode.window.showInformationMessage(
        'DevLens: Import analysis completed.',
        'Show Summary'
    );

if (importAnalysisAction === 'Show Summary') {
    vscode.window.showInformationMessage(message, {
        modal: true
    });
}

console.log('[DevLens] Import/export analysis:', analysis);
console.log('[DevLens] Dependency graph:', graph);
console.log('[DevLens] AST analysis:', ast);

                    }
                );
            } catch (error) {
                const message = error instanceof Error
                    ? error.message
                    : String(error);

                vscode.window.showErrorMessage(
                    `DevLens scan failed: ${message}`
                );
            }
        }
    );

    context.subscriptions.push(analyzeProject);
const visualizeArchitecture = vscode.commands.registerCommand(
    'devlens.visualizeArchitecture',
    async () => {
        const workspace = vscode.workspace.workspaceFolders?.[0];

        if (!workspace) {
            vscode.window.showWarningMessage(
                'DevLens: Open a project folder first.'
            );
            return;
        }

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'DevLens: Building architecture map...',
                    cancellable: false
                },
                async () => {
                    const snapshot = await analysisCache.getSnapshot(workspace.uri, false, getDevLensConfig().exclude);
                    showArchitecturePanel(snapshot.dependencyGraph, workspace.uri, snapshot.architecture);
                }
            );
        } catch (error) {
            const details = error instanceof Error
                ? error.message
                : String(error);

            vscode.window.showErrorMessage(
                `DevLens architecture failed: ${details}`
            );
        }
    }
);

context.subscriptions.push(visualizeArchitecture);

const exploreRelationships = vscode.commands.registerCommand(
    'devlens.exploreRelationships',
    async () => {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            vscode.window.showWarningMessage('DevLens: Open a project folder first.');
            return;
        }

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'DevLens: Building code relationships...',
                    cancellable: false
                },
                async () => {
                    const snapshot = await analysisCache.getSnapshot(workspace.uri, false, getDevLensConfig().exclude);
                    const relationshipGraph = snapshot.relationshipGraph;

                    if (!relationshipGraph.symbols.length) {
                        vscode.window.showInformationMessage(
                            'DevLens: No JavaScript or TypeScript symbols were found.'
                        );
                        return;
                    }

                    const choice = await vscode.window.showQuickPick(
                        relationshipGraph.symbols.map(symbol => ({
                            label: symbol.name,
                            description: `${symbol.kind} · ${symbol.filePath}:${symbol.line}`,
                            detail: symbol.isExported ? 'Exported symbol' : undefined,
                            symbolId: symbol.id
                        })),
                        {
                            title: 'DevLens: Explore Code Relationships',
                            placeHolder: 'Select a function, class, method, or variable'
                        }
                    );
                    if (!choice) return;

                    const relationships = getSymbolRelationships(
                        relationshipGraph,
                        choice.symbolId
                    );
                    if (relationships) showRelationshipPanel(relationships, workspace.uri);
                }
            );
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`DevLens relationship analysis failed: ${details}`);
        }
    }
);

context.subscriptions.push(exploreRelationships);

const explainCode = vscode.commands.registerCommand(
    'devlens.explainCode',
    async (arg?: string | { symbolName?: string; symbolId?: string }) => {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            vscode.window.showWarningMessage('DevLens: Open a project folder first.');
            return;
        }

        const editor = vscode.window.activeTextEditor;
        const passedSymbolName = typeof arg === 'string'
            ? arg.trim()
            : (arg && typeof arg === 'object' && typeof arg.symbolName === 'string' ? arg.symbolName.trim() : '');
        const passedSymbolId = (arg && typeof arg === 'object' && typeof arg.symbolId === 'string')
            ? arg.symbolId
            : undefined;

        const selectedText = editor?.document.getText(editor.selection).trim() ?? '';
        const wordRange = editor && !selectedText
            ? editor.document.getWordRangeAtPosition(editor.selection.active)
            : undefined;
        const textSymbolName = selectedText || (editor && wordRange
            ? editor.document.getText(wordRange)
            : '');

        const symbolName = passedSymbolName || textSymbolName;
        const hasSelectedName = /^[A-Za-z_$][\w$]*$/.test(symbolName);
        const activeFile = editor
            ? vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/')
            : undefined;

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: hasSelectedName ? `DevLens: Explaining ${symbolName}...` : 'DevLens: Finding symbols to explain...',
                    cancellable: false
                },
                async () => {
                    const snapshot = await analysisCache.getSnapshot(workspace.uri, false, getDevLensConfig().exclude);
                    const relationshipGraph = snapshot.relationshipGraph;

                    if (!relationshipGraph.symbols.length) {
                        vscode.window.showInformationMessage(
                            'DevLens: No JavaScript or TypeScript symbols were found in the project.'
                        );
                        return;
                    }

                    let symbolId: string | undefined = passedSymbolId;

                    if (!symbolId) {
                        const candidates = relationshipGraph.symbols
                            .filter(symbol => !hasSelectedName || symbol.name === symbolName)
                            .sort((a, b) => {
                                const aCurrentFile = a.filePath === activeFile ? -1 : 0;
                                const bCurrentFile = b.filePath === activeFile ? -1 : 0;
                                return aCurrentFile - bCurrentFile || a.filePath.localeCompare(b.filePath) || a.name.localeCompare(b.name);
                            });

                        if (!candidates.length) {
                            vscode.window.showInformationMessage(
                                `DevLens: No analyzed symbol named "${symbolName}" was found.`
                            );
                            return;
                        }

                        if (candidates.length === 1 && hasSelectedName) {
                            symbolId = candidates[0].id;
                        } else {
                            const choice = await vscode.window.showQuickPick(
                                candidates.map(symbol => ({
                                    label: symbol.name,
                                    description: `${symbol.kind} · ${symbol.filePath}:${symbol.line}`,
                                    detail: symbol.isExported ? 'Exported symbol' : undefined,
                                    symbolId: symbol.id
                                })),
                                {
                                    title: 'DevLens: Why Is This Code Here?',
                                    placeHolder: hasSelectedName
                                        ? `Choose the ${symbolName} symbol to explain`
                                        : 'Select a function, class, method, or variable to explain'
                                }
                            );
                            symbolId = choice?.symbolId;
                        }
                    }

                    if (!symbolId) {
                        return;
                    }

                    const relationships = getSymbolRelationships(
                        relationshipGraph,
                        symbolId
                    );
                    if (relationships) {
                        showRelationshipPanel(relationships, workspace.uri);
                    }
                }
            );
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`DevLens explanation failed: ${details}`);
        }
    }
);

context.subscriptions.push(explainCode);

const analyzeImpactCommand = vscode.commands.registerCommand(
    'devlens.analyzeImpact',
    async () => {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            vscode.window.showWarningMessage('DevLens: Open a project folder first.');
            return;
        }

        const editor = vscode.window.activeTextEditor;
        const selectedText = editor?.document.getText(editor.selection).trim() ?? '';
        const wordRange = editor && !selectedText
            ? editor.document.getWordRangeAtPosition(editor.selection.active)
            : undefined;
        const symbolName = selectedText || (editor && wordRange
            ? editor.document.getText(wordRange)
            : '');
        const activeFile = editor
            ? vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/')
            : undefined;

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'DevLens: Calculating impact...',
                    cancellable: false
                },
                async () => {
                    const snapshot = await analysisCache.getSnapshot(workspace.uri, false, getDevLensConfig().exclude);
                    const relationshipGraph = snapshot.relationshipGraph;
                    const hasSelectedName = /^[A-Za-z_$][\w$]*$/.test(symbolName);
                    const candidates = relationshipGraph.symbols
                        .filter(symbol => !hasSelectedName || symbol.name === symbolName)
                        .sort((a, b) => {
                            const aCurrentFile = a.filePath === activeFile ? -1 : 0;
                            const bCurrentFile = b.filePath === activeFile ? -1 : 0;
                            return aCurrentFile - bCurrentFile || a.filePath.localeCompare(b.filePath);
                        });
                    if (!candidates.length) {
                        vscode.window.showInformationMessage(
                            `DevLens: No analyzed symbol named "${symbolName}" was found.`
                        );
                        return;
                    }

                    let symbolId: string | undefined;
                    if (candidates.length === 1) {
                        symbolId = candidates[0].id;
                    } else {
                        const choice = await vscode.window.showQuickPick(
                            candidates.map(symbol => ({
                                label: symbol.name,
                                description: `${symbol.kind} · ${symbol.filePath}:${symbol.line}`,
                                symbolId: symbol.id
                            })),
                            {
                                title: 'DevLens: Analyze Impact',
                                placeHolder: hasSelectedName
                                    ? `Choose the ${symbolName} symbol to analyze`
                                    : 'Select a function, class, method, or variable'
                            }
                        );
                        symbolId = choice?.symbolId;
                    }
                    if (!symbolId) return;

                    const impact = analyzeImpact(relationshipGraph, symbolId);
                    if (impact) showImpactPanel(impact, workspace.uri);
                }
            );
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`DevLens impact analysis failed: ${details}`);
        }
    }
);

context.subscriptions.push(analyzeImpactCommand);

const detectArchitectureCommand = vscode.commands.registerCommand(
    'devlens.detectArchitecture',
    async () => {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            vscode.window.showWarningMessage('DevLens: Open a project folder first.');
            return;
        }

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'DevLens: Detecting architecture...',
                    cancellable: false
                },
                async () => {
                    const snapshot = await analysisCache.getSnapshot(workspace.uri, false, getDevLensConfig().exclude);
                    showArchitectureDetectionPanel(snapshot.architecture);
                }
            );
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`DevLens architecture detection failed: ${details}`);
        }
    }
);

context.subscriptions.push(detectArchitectureCommand);

const traceFlowCommand = vscode.commands.registerCommand(
    'devlens.traceFlow',
    async () => {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            vscode.window.showWarningMessage('DevLens: Open a project folder first.');
            return;
        }

        const editor = vscode.window.activeTextEditor;
        const selectedText = editor?.document.getText(editor.selection).trim() ?? '';
        const wordRange = editor && !selectedText
            ? editor.document.getWordRangeAtPosition(editor.selection.active)
            : undefined;
        const symbolName = selectedText || (editor && wordRange
            ? editor.document.getText(wordRange)
            : '');
        const activeFile = editor
            ? vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/')
            : undefined;

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'DevLens: Tracing code flow...',
                    cancellable: false
                },
                async () => {
                    const snapshot = await analysisCache.getSnapshot(workspace.uri, false, getDevLensConfig().exclude);
                    const relationshipGraph = snapshot.relationshipGraph;
                    const http = snapshot.http;
                    const hasSelectedName = /^[A-Za-z_$][\w$]*$/.test(symbolName);
                    const candidates = relationshipGraph.symbols
                        .filter(symbol => !hasSelectedName || symbol.name === symbolName)
                        .sort((a, b) => {
                            const aCurrentFile = a.filePath === activeFile ? -1 : 0;
                            const bCurrentFile = b.filePath === activeFile ? -1 : 0;
                            return aCurrentFile - bCurrentFile || a.filePath.localeCompare(b.filePath);
                        });
                    if (!candidates.length) {
                        vscode.window.showInformationMessage(
                            `DevLens: No analyzed symbol named "${symbolName}" was found.`
                        );
                        return;
                    }

                    let symbolId: string | undefined;
                    if (candidates.length === 1) {
                        symbolId = candidates[0].id;
                    } else {
                        const choice = await vscode.window.showQuickPick(
                            candidates.map(symbol => ({
                                label: symbol.name,
                                description: `${symbol.kind} · ${symbol.filePath}:${symbol.line}`,
                                symbolId: symbol.id
                            })),
                            {
                                title: 'DevLens: Trace Flow',
                                placeHolder: hasSelectedName
                                    ? `Choose the ${symbolName} symbol to trace`
                                    : 'Select a function, class, method, or variable'
                            }
                        );
                        symbolId = choice?.symbolId;
                    }
                    if (!symbolId) return;

                    const trace = traceFlow(relationshipGraph, symbolId, http, getDevLensConfig().traceMaxDepth);
                    if (trace) showFlowPanel(trace, workspace.uri);
                }
            );
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`DevLens flow trace failed: ${details}`);
        }
    }
);

context.subscriptions.push(traceFlowCommand);
}

export function deactivate() {}
