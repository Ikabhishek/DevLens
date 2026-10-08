import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

    const analyzeProject = vscode.commands.registerCommand(
        'devlens.analyzeProject',
        () => {

            vscode.window.showInformationMessage(
                'DevLens: Project analysis started!'
            );

        }
    );

    context.subscriptions.push(analyzeProject);
}

export function deactivate() {}