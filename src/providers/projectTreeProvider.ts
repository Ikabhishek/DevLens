import * as vscode from 'vscode';

export class ProjectTreeProvider
    implements vscode.TreeDataProvider<vscode.TreeItem> {

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): vscode.TreeItem[] {

        return [
            new vscode.TreeItem(
                'Analyze Project',
                vscode.TreeItemCollapsibleState.None
            )
        ];

    }
}