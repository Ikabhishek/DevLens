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
import { DashboardData, showDashboard } from './providers/dashboardPanel';

async function loadDashboardData(workspaceUri: vscode.Uri): Promise<DashboardData> {
    const project = await scanProject(workspaceUri);
    const filePaths = project.files.map(file => file.relativePath);
    const [imports, ast, architecture] = await Promise.all([
        analyzeImportsAndExports(workspaceUri, filePaths),
        analyzeAst(workspaceUri, filePaths),
        detectArchitecture(workspaceUri, project)
    ]);
    return {
        project,
        ast,
        graph: buildDependencyGraph(imports, filePaths),
        architecture
    };
}

export function activate(context: vscode.ExtensionContext) {
    const projectTreeProvider = new ProjectTreeProvider();

const projectTreeView = vscode.window.createTreeView(
    'devlens.projectView',
    { treeDataProvider: projectTreeProvider }
);

context.subscriptions.push(projectTreeView, projectTreeProvider);
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
                        const project = await scanProject(
                            workspace.uri
                        );
                        
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
                    const project = await scanProject(workspace.uri);

                    const analysis = await analyzeImportsAndExports(
                        workspace.uri,
                        project.files.map(file => file.relativePath)
                    );

                    const graph = buildDependencyGraph(
    analysis,
    project.files.map(file => file.relativePath)
);

                    const architecture = await detectArchitecture(workspace.uri, project);
                    showArchitecturePanel(graph, workspace.uri, architecture);
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
                    const project = await scanProject(workspace.uri);
                    const filePaths = project.files.map(file => file.relativePath);
                    const [imports, ast] = await Promise.all([
                        analyzeImportsAndExports(workspace.uri, filePaths),
                        analyzeAst(workspace.uri, filePaths)
                    ]);
                    const dependencyGraph = buildDependencyGraph(imports, filePaths);
                    const relationshipGraph = buildRelationshipGraph(ast, dependencyGraph);

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
    async () => {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        const editor = vscode.window.activeTextEditor;
        if (!workspace) {
            vscode.window.showWarningMessage('DevLens: Open a project folder first.');
            return;
        }
        if (!editor) {
            vscode.window.showInformationMessage(
                'DevLens: Open a JavaScript or TypeScript file and select a symbol.'
            );
            return;
        }

        const selectedText = editor.document.getText(editor.selection).trim();
        const wordRange = selectedText
            ? undefined
            : editor.document.getWordRangeAtPosition(editor.selection.active);
        const symbolName = selectedText || (wordRange
            ? editor.document.getText(wordRange)
            : '');
        if (!/^[A-Za-z_$][\w$]*$/.test(symbolName)) {
            vscode.window.showInformationMessage(
                'DevLens: Select a single function, class, method, or variable name.'
            );
            return;
        }

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `DevLens: Explaining ${symbolName}...`,
                    cancellable: false
                },
                async () => {
                    const project = await scanProject(workspace.uri);
                    const filePaths = project.files.map(file => file.relativePath);
                    const [imports, ast] = await Promise.all([
                        analyzeImportsAndExports(workspace.uri, filePaths),
                        analyzeAst(workspace.uri, filePaths)
                    ]);
                    const dependencyGraph = buildDependencyGraph(imports, filePaths);
                    const relationshipGraph = buildRelationshipGraph(ast, dependencyGraph);
                    const activeFile = vscode.workspace.asRelativePath(editor.document.uri, false)
                        .replace(/\\/g, '/');
                    const matches = relationshipGraph.symbols.filter(symbol =>
                        symbol.name === symbolName
                    ).sort((a, b) => {
                        const aCurrentFile = a.filePath === activeFile ? -1 : 0;
                        const bCurrentFile = b.filePath === activeFile ? -1 : 0;
                        return aCurrentFile - bCurrentFile || a.filePath.localeCompare(b.filePath);
                    });

                    if (!matches.length) {
                        vscode.window.showInformationMessage(
                            `DevLens: No analyzed symbol named "${symbolName}" was found.`
                        );
                        return;
                    }

                    const selectedSymbol = matches.length === 1
                        ? matches[0]
                        : await vscode.window.showQuickPick(
                            matches.map(symbol => ({
                                label: symbol.name,
                                description: `${symbol.kind} · ${symbol.filePath}:${symbol.line}`,
                                symbolId: symbol.id
                            })),
                            {
                                title: `Why Is This Code Here? ${symbolName}`,
                                placeHolder: 'Choose the symbol to explain'
                            }
                        );
                    if (!selectedSymbol) return;

                    const symbolId = 'symbolId' in selectedSymbol
                        ? selectedSymbol.symbolId
                        : selectedSymbol.id;
                    const relationships = getSymbolRelationships(
                        relationshipGraph,
                        symbolId
                    );
                    if (relationships) showRelationshipPanel(relationships, workspace.uri);
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
                    const project = await scanProject(workspace.uri);
                    const filePaths = project.files.map(file => file.relativePath);
                    const [imports, ast] = await Promise.all([
                        analyzeImportsAndExports(workspace.uri, filePaths),
                        analyzeAst(workspace.uri, filePaths)
                    ]);
                    const relationshipGraph = buildRelationshipGraph(
                        ast,
                        buildDependencyGraph(imports, filePaths)
                    );
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
                    const project = await scanProject(workspace.uri);
                    const architecture = await detectArchitecture(workspace.uri, project);
                    showArchitectureDetectionPanel(architecture);
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
                    const project = await scanProject(workspace.uri);
                    const filePaths = project.files.map(file => file.relativePath);
                    const [imports, ast, http] = await Promise.all([
                        analyzeImportsAndExports(workspace.uri, filePaths),
                        analyzeAst(workspace.uri, filePaths),
                        analyzeHttp(workspace.uri, filePaths)
                    ]);
                    const relationshipGraph = buildRelationshipGraph(
                        ast,
                        buildDependencyGraph(imports, filePaths)
                    );
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

                    const trace = traceFlow(relationshipGraph, symbolId, http);
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
