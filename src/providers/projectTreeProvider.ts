import * as vscode from 'vscode';

export class ProjectTreeProvider
    implements vscode.TreeDataProvider<vscode.TreeItem> {

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): vscode.TreeItem[] {

        const item = new vscode.TreeItem(
            'Analyze Project',
            vscode.TreeItemCollapsibleState.None
        );

        item.command = {
            command: 'devlens.analyzeProject',
            title: 'Analyze Project'
        };

        return [item];
    }
}