import * as path from 'path';
import * as vscode from 'vscode';
import { SymbolRelationships } from '../graph/relationshipEngine';

export function showRelationshipPanel(
    relationships: SymbolRelationships,
    rootUri: vscode.Uri
): void {
    const panel = vscode.window.createWebviewPanel(
        'devlensRelationships',
        `Why Is This Code Here? ${relationships.symbol.name}`,
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

    const symbol = relationships.symbol;
    const kindColour: Record<string, string> = {
        function: '#38bdf8', class: '#a78bfa', method: '#2dd4bf', variable: '#fb923c'
    };
    const colour = kindColour[symbol.kind] ?? 'var(--vscode-textLink-foreground)';

    const role = symbol.isExported
        ? `This exported ${symbol.kind} is publicly available to any file that imports <code>${escapeHtml(symbol.filePath)}</code>.`
        : `This ${symbol.kind} is currently scoped locally inside <code>${escapeHtml(symbol.filePath)}</code>.`;

    const callerItems = relationships.callers.length
        ? relationships.callers.map(c => `
            <div class="call-item">
                <div class="call-location">${openButton(c.callerFile, c.line, `${c.callerFile}:${c.line}`)}</div>
                <div class="call-desc">${escapeHtml(c.callerSymbol ? `${c.callerSymbol}() → ${c.expression}()` : `${c.expression}()`)}</div>
            </div>`).join('')
        : '<div class="empty-state">✓ No resolved callers found — this symbol is not called by tracked code.</div>';

    const depItems = relationships.localDependencies.length
        ? relationships.localDependencies.map(d => `
            <div class="dep-item">
                <span class="dep-icon" style="color:${kindColour[d.kind] ?? colour}">◈</span>
                <div>${openButton(d.filePath, d.line, `${d.name}`)}
                <div class="call-desc">${escapeHtml(d.kind)} · ${escapeHtml(d.filePath)}:${d.line}</div></div>
            </div>`).join('')
        : '<div class="empty-state">No resolved local symbol dependencies found.</div>';

    const fileItems = relationships.importedBy.length
        ? relationships.importedBy.map(f => `
            <div class="file-item">
                <span class="file-dot"></span>
                <span>${openButton(f, 1, f)}</span>
            </div>`).join('')
        : '<div class="empty-state">No local files import this file.</div>';

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; padding: 20px 22px 32px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: 13px; }
/* Breadcrumb */
.breadcrumb { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 16px; flex-wrap: wrap; }
.bc-sep { opacity: .4; }
.bc-current { color: var(--vscode-foreground); font-weight: 600; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Header */
.header { padding-bottom: 14px; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 0; }
.kind-badge { display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; border: 1px solid; margin-right: 5px; margin-bottom: 8px; letter-spacing: .3px; }
.export-badge { display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; border: 1px solid #4ade80; color: #4ade80; background: rgba(74,222,128,.08); margin-bottom: 8px; }
.symbol-name { font-size: 22px; font-weight: 700; margin: 0 0 3px; word-break: break-all; line-height: 1.3; }
.symbol-meta { color: var(--vscode-descriptionForeground); font-size: 12px; font-family: var(--vscode-editor-font-family, monospace); }
/* Tabs */
.tab-bar { display: flex; border-bottom: 1px solid var(--vscode-panel-border); margin: 0 -22px 16px; padding: 0 22px; gap: 0; overflow-x: auto; }
.tab-btn { padding: 11px 16px; border: none; border-bottom: 2px solid transparent; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; font: inherit; font-size: 13px; white-space: nowrap; transition: color .12s, border-color .12s; }
.tab-btn:hover { color: var(--vscode-foreground); }
.tab-btn.active { color: var(--vscode-textLink-foreground); border-bottom-color: var(--vscode-textLink-foreground); }
.tab-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 16px; padding: 0 5px; border-radius: 999px; background: var(--vscode-badge-background, rgba(128,128,128,.25)); color: var(--vscode-badge-foreground, inherit); font-size: 10px; margin-left: 6px; vertical-align: middle; }
/* Tab panes */
.tab-pane { display: none; animation: fadeIn .15s ease; }
.tab-pane.active { display: block; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
/* Call items */
.call-item { padding: 10px 13px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; margin-bottom: 8px; background: var(--vscode-sideBar-background); transition: border-color .12s; }
.call-item:hover { border-color: var(--vscode-focusBorder); }
.call-location { font-weight: 600; margin-bottom: 3px; }
.call-desc { color: var(--vscode-descriptionForeground); font-size: 12px; font-family: var(--vscode-editor-font-family, monospace); }
/* Dep items */
.dep-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 13px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; margin-bottom: 8px; background: var(--vscode-sideBar-background); transition: border-color .12s; }
.dep-item:hover { border-color: var(--vscode-focusBorder); }
.dep-icon { font-size: 18px; margin-top: 1px; flex-shrink: 0; }
/* File items */
.file-item { display: flex; align-items: center; gap: 9px; padding: 7px 10px; border-radius: 6px; transition: background .1s; }
.file-item:hover { background: var(--vscode-list-hoverBackground); }
.file-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-textLink-foreground); flex-shrink: 0; }
/* Overview role */
.role-card { padding: 14px 16px; border: 1px solid var(--vscode-panel-border); border-radius: 10px; background: var(--vscode-sideBar-background); margin-bottom: 12px; line-height: 1.6; }
.role-card code { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; background: rgba(128,128,128,.12); padding: 1px 5px; border-radius: 4px; }
.location-btn { margin-top: 12px; display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: transparent; color: var(--vscode-textLink-foreground); cursor: pointer; font: inherit; font-size: 13px; transition: background .12s, border-color .12s; }
.location-btn:hover { background: var(--vscode-list-hoverBackground); border-color: var(--vscode-focusBorder); }
/* Shared */
.empty-state { padding: 28px 16px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 13px; border: 1px dashed var(--vscode-panel-border); border-radius: 10px; }
.link { border: 0; padding: 0; background: transparent; color: var(--vscode-textLink-foreground); cursor: pointer; text-align: left; font: inherit; font-size: inherit; }
.link:hover { text-decoration: underline; }
.muted { color: var(--vscode-descriptionForeground); }
</style></head><body>

<nav class="breadcrumb">
  <span>DevLens</span>
  <span class="bc-sep">›</span>
  <span>Why Is This Code Here?</span>
  <span class="bc-sep">›</span>
  <span class="bc-current">${escapeHtml(symbol.name)}</span>
</nav>

<div class="header">
  <div>
    <span class="kind-badge" style="color:${colour};border-color:${colour};background:${colour}18">${escapeHtml(symbol.kind)}</span>
    ${symbol.isExported ? '<span class="export-badge">exported</span>' : ''}
  </div>
  <div class="symbol-name">${escapeHtml(symbol.name)}</div>
  <div class="symbol-meta">${escapeHtml(symbol.filePath)}:${symbol.line}</div>
</div>

<div class="tab-bar">
  <button class="tab-btn active" data-tab="overview">Overview</button>
  <button class="tab-btn" data-tab="callers">Callers <span class="tab-badge">${relationships.callers.length}</span></button>
  <button class="tab-btn" data-tab="deps">Dependencies <span class="tab-badge">${relationships.localDependencies.length}</span></button>
  <button class="tab-btn" data-tab="files">Used by files <span class="tab-badge">${relationships.importedBy.length}</span></button>
</div>

<div class="tab-pane active" data-tab="overview">
  <div class="role-card">${role}
    <div><button class="location-btn link" data-file="${escapeHtml(symbol.filePath)}" data-line="${symbol.line}">↗ Open ${escapeHtml(symbol.filePath)}:${symbol.line}</button></div>
  </div>
  <div class="role-card muted" style="font-size:12px">
    <strong>Imports from</strong>
    ${relationships.importsFrom.length
        ? relationships.importsFrom.map(f => `<div style="margin-top:6px">${openButton(f, 1, f)}</div>`).join('')
        : '<div style="margin-top:6px">—  No local imports from this file.</div>'}
  </div>
</div>

<div class="tab-pane" data-tab="callers">${callerItems}</div>
<div class="tab-pane" data-tab="deps">${depItems}</div>
<div class="tab-pane" data-tab="files">${fileItems}</div>

<script>
const vscode = acquireVsCodeApi();
// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.dataset.tab === tab));
}));
// File navigation links
document.querySelectorAll('.link').forEach(button => button.addEventListener('click', () => {
    vscode.postMessage({ command: 'openLocation', filePath: button.dataset.file, line: Number(button.dataset.line) });
}));
</script>
</body></html>`;
}

