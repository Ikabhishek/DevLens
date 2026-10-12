
import * as vscode from 'vscode';
import * as path from 'path';
import { DependencyGraph } from '../graph/dependencyGraph';

export function showArchitecturePanel(
    graph: DependencyGraph,
    rootUri: vscode.Uri
): void {
    const panel = vscode.window.createWebviewPanel(
        'devlensArchitecture',
        'DevLens Architecture',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            localResourceRoots: []
        }
    );

    panel.webview.html = getWebviewContent(graph);

    panel.webview.onDidReceiveMessage(async message => {
        if (message.command !== 'openFile') {
            return;
        }

        if (typeof message.filePath !== 'string') {
            return;
        }

        const normalizedPath = path.posix.normalize(
            message.filePath.replace(/\\/g, '/')
        );

        if (
            path.posix.isAbsolute(normalizedPath) ||
            normalizedPath === '..' ||
            normalizedPath.startsWith('../')
        ) {
            return;
        }

        try {
            const fileUri = vscode.Uri.joinPath(
                rootUri,
                normalizedPath
            );

            const document =
                await vscode.workspace.openTextDocument(fileUri);

            await vscode.window.showTextDocument(document);
        } catch (error) {
            const details = error instanceof Error
                ? error.message
                : String(error);

            vscode.window.showErrorMessage(
                `DevLens could not open the file: ${details}`
            );
        }
    });
}

function getWebviewContent(graph: DependencyGraph): string {
    const nodes = [...new Set(graph.nodes)].sort();

    const escapeHtml = (value: string): string =>
        value.replace(/[&<>"']/g, character => {
            const entities: Record<string, string> = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            };

            return entities[character];
        });

    const nodeCards = nodes.map(file => {
        const outgoing = graph.edges.filter(
            edge => edge.from === file
        );

        const incoming = graph.edges.filter(
            edge => edge.to === file
        );

        const dependencies = outgoing.length
            ? outgoing.map(edge => `
                <li>
                    <button
                        class="file-link"
                        data-file="${escapeHtml(edge.to)}">
                        ${escapeHtml(edge.to)}
                    </button>
                </li>
            `).join('')
            : '<li class="muted">No local dependencies</li>';

        return `
            <article class="node">
                <button
                    class="file-link file-title"
                    data-file="${escapeHtml(file)}">
                    ${escapeHtml(file)}
                </button>

                <p class="meta">
                    Imports: ${outgoing.length}
                    &nbsp;·&nbsp;
                    Imported by: ${incoming.length}
                </p>

                <details>
                    <summary>Show dependencies</summary>
                    <ul>${dependencies}</ul>
                </details>
            </article>
        `;
    }).join('');

    const edgeRows = graph.edges.length
        ? graph.edges.map(edge => `
            <tr>
                <td>${escapeHtml(edge.from)}</td>
                <td>→</td>
                <td>${escapeHtml(edge.to)}</td>
                <td>${escapeHtml(
                    edge.importedNames.join(', ') || 'module'
                )}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="4">No local dependencies found.</td></tr>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta
        http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <title>DevLens Architecture</title>

    <style>
        body {
            padding: 20px;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            font-family: var(--vscode-font-family);
        }

        h1, h2 { font-weight: 600; }

        .stats {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin: 20px 0;
        }

        .stat, .node {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 14px;
        }

        .stat { min-width: 120px; }

        .stat strong {
            display: block;
            font-size: 22px;
            margin-bottom: 4px;
        }

        .nodes {
            display: grid;
            grid-template-columns:
                repeat(auto-fit, minmax(260px, 1fr));
            gap: 12px;
        }

        .node {
            min-width: 0;
            background: var(--vscode-sideBar-background);
        }

        button {
            cursor: pointer;
            font: inherit;
        }

        .file-link {
            border: none;
            padding: 0;
            color: var(--vscode-textLink-foreground);
            background: transparent;
            text-align: left;
            overflow-wrap: anywhere;
        }

        .file-link:hover { text-decoration: underline; }

        .file-title {
            font-weight: 600;
            font-size: 14px;
        }

        .meta, .muted {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }

        details { margin-top: 12px; }
        summary { cursor: pointer; }

        li { margin: 8px 0; overflow-wrap: anywhere; }

        .table-wrap { overflow-x: auto; }

        table {
            border-collapse: collapse;
            width: 100%;
            margin-top: 12px;
        }

        th, td {
            text-align: left;
            padding: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
            overflow-wrap: anywhere;
        }

        th { color: var(--vscode-descriptionForeground); }
    </style>
</head>

<body>
    <h1>DevLens Architecture</h1>
    <p>Explore files and their local import relationships.</p>

    <section class="stats">
        <div class="stat">
            <strong>${nodes.length}</strong>
            Files
        </div>
        <div class="stat">
            <strong>${graph.edges.length}</strong>
            Dependencies
        </div>
    </section>

    <h2>Project files</h2>
    <section class="nodes">
        ${nodeCards || '<p>No files were analyzed.</p>'}
    </section>

    <h2>Dependency connections</h2>
    <p class="muted">
        Each row represents an import from one file to another.
    </p>

    <div class="table-wrap">
        <table>
            <thead>
                <tr>
                    <th>Importer</th>
                    <th></th>
                    <th>Imported file</th>
                    <th>Imported names</th>
                </tr>
            </thead>
            <tbody>${edgeRows}</tbody>
        </table>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        document.querySelectorAll('.file-link').forEach(button => {
            button.addEventListener('click', () => {
                vscode.postMessage({
                    command: 'openFile',
                    filePath: button.dataset.file
                });
            });
        });
    </script>
</body>
</html>`;
}
