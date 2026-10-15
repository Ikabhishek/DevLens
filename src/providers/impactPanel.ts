import * as path from 'path';
import * as vscode from 'vscode';
import { ImpactAnalysis } from '../graph/impactAnalyzer';

export function showImpactPanel(impact: ImpactAnalysis, rootUri: vscode.Uri): void {
    const panel = vscode.window.createWebviewPanel(
        'devlensImpact',
        `DevLens Impact: ${impact.symbol.name}`,
        vscode.ViewColumn.One,
        { enableScripts: true, localResourceRoots: [] }
    );
    panel.webview.html = getWebviewContent(impact);
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

function getWebviewContent(impact: ImpactAnalysis): string {
    const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char] ?? char);
    const openButton = (filePath: string, line = 1): string =>
        `<button class="link" data-file="${escapeHtml(filePath)}" data-line="${line}">${escapeHtml(filePath)}${line > 1 ? `:${line}` : ''}</button>`;
    const list = (items: string[], empty: string): string => items.length
        ? `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`
        : `<p class="muted">${empty}</p>`;
    const callers = impact.directCallers.map(caller =>
        `${openButton(caller.callerFile, caller.line)} — ${escapeHtml(caller.callerSymbol ? `${caller.callerSymbol}() calls ${caller.expression}()` : `${caller.expression}()` )}`
    );
    const directFiles = impact.directImporters.map(file => openButton(file));
    const transitiveFiles = impact.transitiveImporters.map(file => openButton(file));

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
body { padding: 20px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
.card { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 14px; margin: 12px 0; }
.risk { font-size: 20px; font-weight: 700; } .HIGH { color: var(--vscode-errorForeground); } .MEDIUM { color: var(--vscode-editorWarning-foreground); } .LOW { color: var(--vscode-testing-iconPassed); }
.meta, .muted { color: var(--vscode-descriptionForeground); } .link { border: 0; padding: 0; background: transparent; color: var(--vscode-textLink-foreground); cursor: pointer; font: inherit; text-align: left; }
.link:hover { text-decoration: underline; } li { margin: 8px 0; overflow-wrap: anywhere; }
</style></head><body>
<h1>Impact Analysis</h1><p class="meta">${escapeHtml(impact.symbol.name)} · ${escapeHtml(impact.symbol.filePath)}:${impact.symbol.line}</p>
<section class="card"><div class="risk ${impact.level}">${impact.level} impact</div><p>${impact.affectedFiles.length} potentially affected local file${impact.affectedFiles.length === 1 ? '' : 's'}.</p></section>
<section class="card"><h2>Direct callers</h2>${list(callers, 'No resolved callers found.')}</section>
<section class="card"><h2>Directly importing files</h2>${list(directFiles, 'No local files import this source file.')}</section>
<section class="card"><h2>Transitively affected files</h2>${list(transitiveFiles, 'No additional files depend on those importers.')}</section>
</body><script>const vscode = acquireVsCodeApi(); document.querySelectorAll('.link').forEach(button => button.addEventListener('click', () => vscode.postMessage({ command: 'openLocation', filePath: button.dataset.file, line: Number(button.dataset.line) })));</script></html>`;
}
