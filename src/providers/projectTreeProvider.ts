
import * as vscode from 'vscode';

export class ProjectTreeProvider
    implements vscode.TreeDataProvider<vscode.TreeItem> {

    private readonly onDidChangeTreeDataEmitter =
        new vscode.EventEmitter<
            vscode.TreeItem | undefined | null | void
        >();

    readonly onDidChangeTreeData =
        this.onDidChangeTreeDataEmitter.event;

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): vscode.TreeItem[] {
        const workspace =
            vscode.workspace.workspaceFolders?.[0];

        if (!workspace) {
            const emptyItem = new vscode.TreeItem(
                'Open a project folder',
                vscode.TreeItemCollapsibleState.None
            );

            emptyItem.iconPath =
                new vscode.ThemeIcon('folder-open');

            return [emptyItem];
        }

        const projectItem = new vscode.TreeItem(
            workspace.name,
            vscode.TreeItemCollapsibleState.None
        );

        projectItem.iconPath =
            new vscode.ThemeIcon('folder');

        projectItem.tooltip = workspace.uri.fsPath;

        const analyzeItem = new vscode.TreeItem(
            'Analyze Project',
            vscode.TreeItemCollapsibleState.None
        );

        analyzeItem.iconPath =
            new vscode.ThemeIcon('search');

        analyzeItem.description = 'Scan files and statistics';

        analyzeItem.command = {
            command: 'devlens.analyzeProject',
            title: 'Analyze Project'
        };

        const architectureItem = new vscode.TreeItem(
            'Visualize Architecture',
            vscode.TreeItemCollapsibleState.None
        );

        architectureItem.iconPath =
            new vscode.ThemeIcon('type-hierarchy');

        architectureItem.description =
            'Explore local dependencies';

        architectureItem.command = {
            command: 'devlens.visualizeArchitecture',
            title: 'Visualize Architecture'
        };

        const relationshipsItem = new vscode.TreeItem(
            'Explore Code Relationships',
            vscode.TreeItemCollapsibleState.None
        );

        relationshipsItem.iconPath = new vscode.ThemeIcon('references');
        relationshipsItem.description = 'Find callers and dependencies';
        relationshipsItem.command = {
            command: 'devlens.exploreRelationships',
            title: 'Explore Code Relationships'
        };

        const explainCodeItem = new vscode.TreeItem(
            'Why Is This Code Here?',
            vscode.TreeItemCollapsibleState.None
        );

        explainCodeItem.iconPath = new vscode.ThemeIcon('question');
        explainCodeItem.description = 'Explain a selected symbol';
        explainCodeItem.command = {
            command: 'devlens.explainCode',
            title: 'Why Is This Code Here?'
        };

        const refreshItem = new vscode.TreeItem(
            'Refresh Dashboard',
            vscode.TreeItemCollapsibleState.None
        );

        refreshItem.iconPath =
            new vscode.ThemeIcon('refresh');

        refreshItem.command = {
            command: 'devlens.refreshDashboard',
            title: 'Refresh Dashboard'
        };

        return [
            projectItem,
            analyzeItem,
            architectureItem,
            relationshipsItem,
            explainCodeItem,
            refreshItem
        ];
    }

    refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    dispose(): void {
        this.onDidChangeTreeDataEmitter.dispose();
    }
}
