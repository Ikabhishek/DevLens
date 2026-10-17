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

    const riskConfig = {
        HIGH:   { colour: 'var(--vscode-errorForeground)',           bg: 'rgba(239,68,68,.08)',   icon: '⚠', label: 'High Impact' },
        MEDIUM: { colour: 'var(--vscode-editorWarning-foreground)',  bg: 'rgba(234,179,8,.08)',   icon: '◉', label: 'Medium Impact' },
        LOW:    { colour: 'var(--vscode-testing-iconPassed,#4ade80)', bg: 'rgba(74,222,128,.08)',  icon: '✓', label: 'Low Impact' }
    }[impact.level];

    const callerItems = impact.directCallers.length
        ? impact.directCallers.map(c => `
            <div class="file-card">
                <div class="file-name">${openButton(c.callerFile, c.line)}</div>
                <div class="file-desc">${escapeHtml(c.callerSymbol ? `${c.callerSymbol}() calls ${c.expression}()` : `${c.expression}()`)}</div>
            </div>`).join('')
        : '<div class="empty-state">No resolved callers found.</div>';

    const directList = impact.directImporters.length
        ? impact.directImporters.map(f => `<div class="file-row"><span class="dot"></span>${openButton(f)}</div>`).join('')
        : '<div class="empty-state">No local files import this source file.</div>';

    const transitiveList = impact.transitiveImporters.length
        ? impact.transitiveImporters.map(f => `<div class="file-row"><span class="dot dot-dim"></span>${openButton(f)}</div>`).join('')
        : '<div class="empty-state">No additional transitive dependents.</div>';

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; padding: 20px 22px 32px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: 13px; }
.breadcrumb { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 16px; flex-wrap: wrap; }
.bc-sep { opacity: .4; }
.bc-current { color: var(--vscode-foreground); font-weight: 600; }
.header { padding-bottom: 14px; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 18px; }
.symbol-name { font-size: 20px; font-weight: 700; margin: 0 0 3px; word-break: break-all; }
.symbol-meta { color: var(--vscode-descriptionForeground); font-size: 12px; font-family: var(--vscode-editor-font-family, monospace); }
/* Risk badge */
.risk-banner { display: flex; align-items: center; gap: 16px; padding: 16px 20px; border-radius: 12px; border: 1px solid; margin-bottom: 18px; }
.risk-icon { font-size: 32px; line-height: 1; }
.risk-label { font-size: 20px; font-weight: 800; letter-spacing: .2px; }
.risk-sub { font-size: 13px; color: var(--vscode-descriptionForeground); margin-top: 3px; }
/* Stats row */
.stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 20px; }
.stat-card { padding: 12px 14px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-sideBar-background); text-align: center; }
.stat-card strong { display: block; font-size: 24px; color: var(--vscode-textLink-foreground); }
.stat-card span { font-size: 11px; color: var(--vscode-descriptionForeground); }
/* Section */
.section { margin-bottom: 20px; }
.section-title { font-size: 14px; font-weight: 700; margin: 0 0 10px; }
/* File cards (callers) */
.file-card { padding: 10px 13px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; margin-bottom: 8px; background: var(--vscode-sideBar-background); transition: border-color .12s; }
.file-card:hover { border-color: var(--vscode-focusBorder); }
.file-name { font-weight: 600; margin-bottom: 3px; }
.file-desc { color: var(--vscode-descriptionForeground); font-size: 12px; font-family: var(--vscode-editor-font-family, monospace); }
/* File rows (importers) */
.file-row { display: flex; align-items: center; gap: 9px; padding: 7px 10px; border-radius: 6px; transition: background .1s; }
.file-row:hover { background: var(--vscode-list-hoverBackground); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-textLink-foreground); flex-shrink: 0; }
.dot-dim { opacity: .5; }
/* Shared */
.empty-state { padding: 20px 14px; text-align: center; color: var(--vscode-descriptionForeground); border: 1px dashed var(--vscode-panel-border); border-radius: 8px; }
.link { border: 0; padding: 0; background: transparent; color: var(--vscode-textLink-foreground); cursor: pointer; font: inherit; text-align: left; overflow-wrap: anywhere; }
.link:hover { text-decoration: underline; }
</style></head><body>

<nav class="breadcrumb">
  <span>DevLens</span>
  <span class="bc-sep">›</span>
  <span>Impact Analysis</span>
  <span class="bc-sep">›</span>
  <span class="bc-current">${escapeHtml(impact.symbol.name)}</span>
</nav>

<div class="header">
  <div class="symbol-name">${escapeHtml(impact.symbol.name)}</div>
  <div class="symbol-meta">${escapeHtml(impact.symbol.kind)} · ${escapeHtml(impact.symbol.filePath)}:${impact.symbol.line}</div>
</div>

<div class="risk-banner" style="color:${riskConfig.colour};border-color:${riskConfig.colour};background:${riskConfig.bg}">
  <span class="risk-icon">${riskConfig.icon}</span>
  <div>
    <div class="risk-label">${riskConfig.label}</div>
    <div class="risk-sub">${impact.affectedFiles.length} potentially affected file${impact.affectedFiles.length === 1 ? '' : 's'} if this ${escapeHtml(impact.symbol.kind)} changes.</div>
  </div>
</div>

<div class="stats-row">
  <div class="stat-card"><strong>${impact.directCallers.length}</strong><span>Direct callers</span></div>
  <div class="stat-card"><strong>${impact.directImporters.length}</strong><span>Direct importers</span></div>
  <div class="stat-card"><strong>${impact.transitiveImporters.length}</strong><span>Transitive</span></div>
</div>

<div class="section">
  <div class="section-title">Direct callers</div>
  ${callerItems}
</div>

<div class="section">
  <div class="section-title">Files that directly import this module</div>
  ${directList}
</div>

<div class="section">
  <div class="section-title">Transitively affected files</div>
  ${transitiveList}
</div>

<script>
const vscode = acquireVsCodeApi();
document.querySelectorAll('.link').forEach(button => button.addEventListener('click', () => {
    vscode.postMessage({ command: 'openLocation', filePath: button.dataset.file, line: Number(button.dataset.line) });
}));
</script>
</body></html>`;
}

