import * as vscode from 'vscode';

const IGNORED_DIRECTORIES = new Set([
    '.git', '.svn', 'node_modules', 'dist', 'build', 'coverage',
    '.next', '.nuxt', '.venv', 'venv', '__pycache__', 'out'
]);

class WorkspaceItem extends vscode.TreeItem {
    constructor(
        readonly uri: vscode.Uri,
        readonly isDirectory: boolean,
        label: string
    ) {
        super(
            label,
            isDirectory
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );
        this.resourceUri = uri;
        this.tooltip = uri.fsPath;
        if (!isDirectory) {
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [uri]
            };
        }
    }
}

export class ProjectTreeProvider implements vscode.TreeDataProvider<WorkspaceItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
        WorkspaceItem | undefined | null | void
    >();

    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    getTreeItem(element: WorkspaceItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: WorkspaceItem): Promise<WorkspaceItem[]> {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) return [];

        const directory = element?.uri ?? workspace.uri;
        try {
            const entries = await vscode.workspace.fs.readDirectory(directory);
            return entries
                .filter(([name, type]) =>
                    type !== vscode.FileType.SymbolicLink &&
                    !(type === vscode.FileType.Directory && IGNORED_DIRECTORIES.has(name))
                )
                .sort(([aName, aType], [bName, bType]) => {
                    if (aType !== bType) return aType === vscode.FileType.Directory ? -1 : 1;
                    return aName.localeCompare(bName);
                })
                .map(([name, type]) => new WorkspaceItem(
                    vscode.Uri.joinPath(directory, name),
                    type === vscode.FileType.Directory,
                    name
                ));
        } catch {
            return [];
        }
    }

    refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    dispose(): void {
        this.onDidChangeTreeDataEmitter.dispose();
    }
}
