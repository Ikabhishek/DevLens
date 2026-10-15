import { analyzeImportsAndExports } from './analyzer/importExportAnalyzer';
import { buildDependencyGraph } from './graph/dependencyGraph';
import * as vscode from 'vscode';
import { scanProject } from './scanner/projectScanner';
import { showArchitecturePanel } from './providers/architecturePanel';
import { ProjectTreeProvider } from './providers/projectTreeProvider';
import { analyzeAst } from './analyzer/astAnalyzer';

export function activate(context: vscode.ExtensionContext) {
    const projectTreeProvider = new ProjectTreeProvider();

context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
        'devlens.projectView',
        projectTreeProvider
    ),
    projectTreeProvider
);

const refreshDashboard = vscode.commands.registerCommand(
    'devlens.refreshDashboard',
    () => {
        projectTreeProvider.refresh();
    }
);

context.subscriptions.push(refreshDashboard);
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
    `Exports: ${ast.totals.exports}`
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

                    showArchitecturePanel(graph, workspace.uri);
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
}

export function deactivate() {}
