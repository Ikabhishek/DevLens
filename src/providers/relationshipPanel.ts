import * as path from 'path';
import * as vscode from 'vscode';
import { SymbolRelationships } from '../graph/relationshipEngine';

export function showRelationshipPanel(
    relationships: SymbolRelationships,
    rootUri: vscode.Uri
): void {
    const panel = vscode.window.createWebviewPanel(
        'devlensRelationships',
        `DevLens: ${relationships.symbol.name}`,
        vscode.ViewColumn.One,
        { enableScripts: true, localResourceRoots: [] }
    );

    panel.webview.html = getWebviewContent(relationships);
    panel.webview.onDidReceiveMessage(async message => {
        if (message.command !== 'openLocation' ||
            typeof message.filePath !== 'string' ||
            typeof message.line !== 'number') return;

        const filePath = path.posix.normalize(message.filePath.replace(/\\/g, '/'));
        if (path.posix.isAbsolute(filePath) || filePath === '..' || filePath.startsWith('../')) return;

        try {
            const document = await vscode.workspace.openTextDocument(
                vscode.Uri.joinPath(rootUri, filePath)
            );
            const position = new vscode.Position(Math.max(0, message.line - 1), 0);
            await vscode.window.showTextDocument(document, {
                selection: new vscode.Range(position, position)
            });
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`DevLens could not open the source: ${details}`);
        }
    });
}

function getWebviewContent(relationships: SymbolRelationships): string {
    const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char] ?? char);
    const openButton = (filePath: string, line: number, label: string): string =>
        `<button class="link" data-file="${escapeHtml(filePath)}" data-line="${line}">${escapeHtml(label)}</button>`;
    const list = (items: string[], empty: string): string => items.length
        ? `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`
        : `<p class="muted">${empty}</p>`;
    const symbol = relationships.symbol;
    const callers = relationships.callers.map(caller =>
        `${openButton(caller.callerFile, caller.line, `${caller.callerFile}:${caller.line}`)} — ${escapeHtml(caller.callerSymbol ? `${caller.callerSymbol}() calls ${caller.expression}()` : `${caller.expression}()` )}`
    );
    const dependencies = relationships.localDependencies.map(dependency =>
        openButton(dependency.filePath, dependency.line, `${dependency.name} (${dependency.filePath}:${dependency.line})`)
    );

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
body { padding: 20px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
.card { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 14px; margin: 12px 0; }
h1 { margin: 0 0 5px; } h2 { font-size: 15px; margin: 0 0 10px; }
.meta, .muted { color: var(--vscode-descriptionForeground); } .link { border: 0; padding: 0; background: transparent; color: var(--vscode-textLink-foreground); cursor: pointer; text-align: left; font: inherit; }
.link:hover { text-decoration: underline; } li { margin: 8px 0; overflow-wrap: anywhere; }
</style></head><body>
<h1>${escapeHtml(symbol.name)}</h1>
<p class="meta">${escapeHtml(symbol.kind)} · ${escapeHtml(symbol.filePath)}:${symbol.line}${symbol.isExported ? ' · exported' : ''}</p>
<section class="card"><h2>Defined in</h2>${openButton(symbol.filePath, symbol.line, `${symbol.filePath}:${symbol.line}`)}</section>
<section class="card"><h2>Called by</h2>${list(callers, 'No resolved callers found.')}</section>
<section class="card"><h2>Depends on</h2>${list(dependencies, 'No resolved symbol calls were found in this symbol.')}</section>
<section class="card"><h2>Used by files</h2>${list(relationships.importedBy.map(file => escapeHtml(file)), 'No local files import this file.')}</section>
</body><script>
const vscode = acquireVsCodeApi();
document.querySelectorAll('.link').forEach(button => button.addEventListener('click', () => vscode.postMessage({ command: 'openLocation', filePath: button.dataset.file, line: Number(button.dataset.line) })));
</script></html>`;
}
