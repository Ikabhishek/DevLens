import * as path from 'path';
import * as vscode from 'vscode';
import { FlowTrace } from '../graph/flowAnalyzer';

export function showFlowPanel(trace: FlowTrace, rootUri: vscode.Uri): void {
    const panel = vscode.window.createWebviewPanel(
        'devlensFlow',
        `DevLens Flow: ${trace.start.label}`,
        vscode.ViewColumn.One,
        { enableScripts: true, localResourceRoots: [] }
    );
    panel.webview.html = getWebviewContent(trace);
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

function getWebviewContent(trace: FlowTrace): string {
    const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char] ?? char);
    const data = JSON.stringify(trace)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026');
    const edgeList = trace.edges.length
        ? `<ol>${trace.edges.map(edge => {
            const from = trace.nodes.find(node => node.id === edge.from);
            const to = trace.nodes.find(node => node.id === edge.to);
            return `<li>${escapeHtml(from?.label ?? edge.from)} → ${escapeHtml(to?.label ?? edge.to)} <span>via ${escapeHtml(edge.expression)} at line ${edge.line}</span></li>`;
        }).join('')}</ol>`
        : '<p class="muted">No resolved downstream project calls were found.</p>';

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
body { padding: 20px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
.shell { border: 1px solid var(--vscode-panel-border); border-radius: 10px; overflow: hidden; margin: 16px 0; } #flow-graph { display: block; width: 100%; height: 390px; background: var(--vscode-sideBar-background); }
.node { cursor: pointer; } .muted, span { color: var(--vscode-descriptionForeground); } li { margin: 9px 0; } h1 { margin-bottom: 4px; }
</style></head><body>
<h1>Trace Flow</h1><p class="muted">${escapeHtml(trace.start.label)} → downstream local symbols. Click a node to open its source.</p>
<section class="shell"><svg id="flow-graph" role="img" aria-label="Code flow graph"></svg></section>
<h2>Resolved flow steps</h2>${edgeList}
<script>
const vscode = acquireVsCodeApi();
const flow = ${data};
const svg = document.getElementById('flow-graph');
const escapeXml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const layers = new Map(); flow.nodes.forEach(node => { const layer = layers.get(node.depth) || []; layer.push(node); layers.set(node.depth, layer); });
const width = Math.max(760, Math.max(1, ...[...layers.values()].map(layer => layer.length)) * 220 + 80); const height = Math.max(300, layers.size * 130 + 70); const positions = new Map();
[...layers.entries()].sort((a,b) => a[0] - b[0]).forEach(([depth, layer]) => { layer.sort((a,b) => a.label.localeCompare(b.label)); const spacing = width / (layer.length + 1); layer.forEach((node,index) => positions.set(node.id, { x: spacing * (index + 1), y: 48 + depth * 130 })); });
const edges = flow.edges.map(edge => { const from = positions.get(edge.from), to = positions.get(edge.to); if (!from || !to) return ''; return '<path d="M ' + from.x + ' ' + (from.y + 24) + ' C ' + from.x + ' ' + (from.y + 55) + ', ' + to.x + ' ' + (to.y - 55) + ', ' + to.x + ' ' + (to.y - 24) + '" stroke="#38bdf8" fill="none" stroke-width="2" marker-end="url(#arrow)"><title>' + escapeXml(edge.expression) + '</title></path>'; }).join('');
const nodes = flow.nodes.map(node => { const point = positions.get(node.id), label = node.label.length > 24 ? node.label.slice(0, 21) + '…' : node.label; return '<g class="node" data-file="' + escapeXml(node.filePath) + '" data-line="' + node.line + '" transform="translate(' + (point.x - 88) + ' ' + (point.y - 24) + ')" tabindex="0" role="button"><rect width="176" height="48" rx="8" fill="var(--vscode-editor-background)" stroke="#38bdf8" stroke-width="2"></rect><text x="12" y="21" fill="var(--vscode-descriptionForeground)" font-size="10">' + escapeXml(node.kind.toUpperCase()) + '</text><text x="12" y="37" fill="var(--vscode-foreground)" font-size="14">' + escapeXml(label) + '</text><title>' + escapeXml(node.filePath + ':' + node.line) + '</title></g>'; }).join('');
svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height); svg.innerHTML = '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#38bdf8"></path></marker></defs>' + edges + nodes;
svg.querySelectorAll('.node').forEach(node => { const open = () => vscode.postMessage({ command: 'openLocation', filePath: node.dataset.file, line: Number(node.dataset.line) }); node.addEventListener('click', open); node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') open(); }); });
</script></body></html>`;
}
