import * as vscode from 'vscode';
import { ProjectTreeProvider } from './providers/projectTreeProvider';

export function activate(context: vscode.ExtensionContext) {

    const analyzeProject = vscode.commands.registerCommand(
        'devlens.analyzeProject',
        () => {

            vscode.window.showInformationMessage(
                'DevLens: Project analysis started!'
            );

        }
    );

    const projectTreeProvider = new ProjectTreeProvider();

    vscode.window.registerTreeDataProvider(
        'devlens.projectView',
        projectTreeProvider
    );

    context.subscriptions.push(analyzeProject);
}

export function deactivate() {}