
import * as vscode from 'vscode';
import { scanProject } from './scanner/projectScanner';

export function activate(context: vscode.ExtensionContext) {
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
}

export function deactivate() {}
