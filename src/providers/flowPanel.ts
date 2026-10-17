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
        ? `<ol class="step-list">${trace.edges.map(edge => {
            const from = trace.nodes.find(n => n.id === edge.from);
            const to = trace.nodes.find(n => n.id === edge.to);
            return `<li class="step-item"><span class="step-from">${escapeHtml(from?.label ?? edge.from)}</span><span class="step-arrow">→</span><span class="step-to">${escapeHtml(to?.label ?? edge.to)}</span><span class="step-via">via ${escapeHtml(edge.expression)} · line ${edge.line}</span></li>`;
        }).join('')}</ol>`
        : '<div class="empty-state">No resolved downstream project calls were found.</div>';

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; padding: 20px 22px 32px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: 13px; }
.breadcrumb { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 14px; flex-wrap: wrap; }
.bc-sep { opacity: .4; }
.bc-current { color: var(--vscode-foreground); font-weight: 600; }
.header { margin-bottom: 16px; }
.header h1 { font-size: 20px; font-weight: 700; margin: 0 0 3px; }
.header p { margin: 0; color: var(--vscode-descriptionForeground); font-size: 12px; }
/* Graph shell */
.graph-shell { border: 1px solid var(--vscode-panel-border); border-radius: 12px; overflow: hidden; margin-bottom: 18px; }
.graph-toolbar { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
.graph-toolbar button { padding: 4px 9px; border: 1px solid var(--vscode-panel-border); border-radius: 5px; background: transparent; color: var(--vscode-foreground); cursor: pointer; font: inherit; font-size: 12px; transition: background .1s, border-color .1s; }
.graph-toolbar button:hover { background: var(--vscode-list-hoverBackground); border-color: var(--vscode-focusBorder); }
.graph-toolbar .sep { flex: 1; }
#flow-graph { display: block; width: 100%; height: 380px; background: var(--vscode-editor-background); cursor: grab; }
#flow-graph:active { cursor: grabbing; }
/* Legend */
.legend { display: flex; flex-wrap: wrap; gap: 10px; padding: 8px 12px; border-top: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); font-size: 11px; color: var(--vscode-descriptionForeground); }
.legend-item { display: inline-flex; align-items: center; gap: 5px; }
.legend-dot { width: 9px; height: 9px; border-radius: 3px; }
/* Step list */
.section-title { font-size: 14px; font-weight: 700; margin: 0 0 10px; }
.step-list { list-style: none; margin: 0; padding: 0; counter-reset: step; }
.step-item { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 9px 12px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; margin-bottom: 8px; background: var(--vscode-sideBar-background); counter-increment: step; position: relative; padding-left: 40px; transition: border-color .12s; }
.step-item:hover { border-color: var(--vscode-focusBorder); }
.step-item::before { content: counter(step); position: absolute; left: 12px; width: 20px; height: 20px; border-radius: 50%; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.step-from { font-weight: 600; }
.step-arrow { color: var(--vscode-descriptionForeground); }
.step-to { font-weight: 600; color: var(--vscode-textLink-foreground); }
.step-via { font-size: 11px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family, monospace); flex-basis: 100%; margin-left: 0; }
/* Nodes */
.node { cursor: pointer; }
.node rect { transition: stroke-width .1s; }
.node:hover rect { stroke-width: 3; }
/* Shared */
.empty-state { padding: 24px 14px; text-align: center; color: var(--vscode-descriptionForeground); border: 1px dashed var(--vscode-panel-border); border-radius: 8px; }
</style></head><body>

<nav class="breadcrumb">
  <span>DevLens</span>
  <span class="bc-sep">›</span>
  <span>Trace Flow</span>
  <span class="bc-sep">›</span>
  <span class="bc-current">${escapeHtml(trace.start.label)}</span>
</nav>

<div class="header">
  <h1>Trace Flow</h1>
  <p>${escapeHtml(trace.start.label)} → downstream call chain · click a node to open its source</p>
</div>

<div class="graph-shell">
  <div class="graph-toolbar">
    <button id="flow-zoom-out" title="Zoom out">−</button>
    <button id="flow-zoom-in" title="Zoom in">+</button>
    <button id="flow-fit" title="Fit to view">Fit</button>
    <span class="sep"></span>
    <span style="font-size:11px;color:var(--vscode-descriptionForeground)">${trace.nodes.length} nodes · ${trace.edges.length} edges</span>
  </div>
  <svg id="flow-graph" role="img" aria-label="Code flow graph"></svg>
  <div class="legend">
    <span class="legend-item"><i class="legend-dot" style="background:#38bdf8"></i>function</span>
    <span class="legend-item"><i class="legend-dot" style="background:#a78bfa"></i>class</span>
    <span class="legend-item"><i class="legend-dot" style="background:#2dd4bf"></i>method</span>
    <span class="legend-item"><i class="legend-dot" style="background:#fb923c"></i>request</span>
    <span class="legend-item"><i class="legend-dot" style="background:#4ade80"></i>route</span>
    <span class="legend-item"><i class="legend-dot" style="background:#94a3b8"></i>variable / other</span>
  </div>
</div>

<div class="section-title">Resolved flow steps</div>
${edgeList}

<script>
const vscode = acquireVsCodeApi();
const flow = ${data};
const svg = document.getElementById('flow-graph');
const escapeXml = v => v.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
const kindColor = { function:'#38bdf8', class:'#a78bfa', method:'#2dd4bf', variable:'#94a3b8', request:'#fb923c', route:'#4ade80' };
const getColor = kind => kindColor[kind] ?? '#94a3b8';

// Build layout
const layers = new Map();
flow.nodes.forEach(n => { const l = layers.get(n.depth) || []; l.push(n); layers.set(n.depth, l); });
const nodeW = 176, nodeH = 48, layerGap = 130, colGap = 200;
const widest = Math.max(1, ...[...layers.values()].map(l => l.length));
const width = Math.max(760, widest * colGap + 80);
const height = Math.max(300, layers.size * layerGap + 80);
const positions = new Map();
[...layers.entries()].sort((a,b) => a[0]-b[0]).forEach(([depth, layer]) => {
    layer.sort((a,b) => a.label.localeCompare(b.label));
    const spacing = width / (layer.length + 1);
    layer.forEach((n, i) => positions.set(n.id, { x: spacing * (i + 1), y: 50 + depth * layerGap }));
});

// Render
const marker = col => \`<marker id="arr-\${col.replace(/[^a-z0-9]/gi,'')}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="\${col}"></path></marker>\`;
const uniqueColors = [...new Set(flow.nodes.map(n => getColor(n.kind)))];
const defs = uniqueColors.map(marker).join('');
const edges = flow.edges.map(edge => {
    const f = positions.get(edge.from), t = positions.get(edge.to);
    const tn = flow.nodes.find(n => n.id === edge.to);
    if (!f || !t) return '';
    const col = getColor(tn?.kind ?? '');
    const mid = (t.y - f.y) / 2;
    const markId = col.replace(/[^a-z0-9]/gi,'');
    return \`<path d="M \${f.x} \${f.y+24} C \${f.x} \${f.y+Math.max(36,mid)}, \${t.x} \${t.y-Math.max(36,mid)}, \${t.x} \${t.y-24}" stroke="\${col}" fill="none" stroke-width="2" marker-end="url(#arr-\${markId})" opacity=".85"><title>\${escapeXml(edge.expression)}</title></path>\`;
}).join('');
const nodes = flow.nodes.map(n => {
    const p = positions.get(n.id);
    if (!p) return '';
    const col = getColor(n.kind);
    const lbl = n.label.length > 22 ? n.label.slice(0,19)+'…' : n.label;
    return \`<g class="node" data-file="\${escapeXml(n.filePath)}" data-line="\${n.line}" transform="translate(\${p.x-nodeW/2} \${p.y-24})" tabindex="0" role="button"><rect width="\${nodeW}" height="\${nodeH}" rx="8" fill="var(--vscode-sideBar-background)" stroke="\${col}" stroke-width="2"></rect><text x="10" y="19" fill="\${col}" font-size="10" font-weight="700">\${escapeXml(n.kind.toUpperCase())}</text><text x="10" y="36" fill="var(--vscode-foreground)" font-size="13">\${escapeXml(lbl)}</text><title>\${escapeXml(n.filePath+':'+n.line)}</title></g>\`;
}).join('');
svg.setAttribute('viewBox', \`0 0 \${width} \${height}\`);
svg.dataset.initVB = \`0 0 \${width} \${height}\`;
svg.innerHTML = \`<defs>\${defs}</defs>\${edges}\${nodes}\`;
svg.querySelectorAll('.node').forEach(n => {
    const open = () => vscode.postMessage({ command: 'openLocation', filePath: n.dataset.file, line: Number(n.dataset.line) });
    n.addEventListener('click', open);
    n.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
});

// Zoom / pan
const zoom = f => { const b = svg.viewBox.baseVal; const w = b.width*f, h = b.height*f; svg.setAttribute('viewBox', \`\${b.x-(w-b.width)/2} \${b.y-(h-b.height)/2} \${w} \${h}\`); };
document.getElementById('flow-zoom-in').addEventListener('click', () => zoom(0.82));
document.getElementById('flow-zoom-out').addEventListener('click', () => zoom(1.22));
document.getElementById('flow-fit').addEventListener('click', () => svg.setAttribute('viewBox', svg.dataset.initVB));
let pan;
svg.addEventListener('pointerdown', e => { if (e.target.closest('.node')) return; const b = svg.viewBox.baseVal; pan = { x: e.clientX, y: e.clientY, box: { x: b.x, y: b.y, w: b.width, h: b.height } }; svg.setPointerCapture(e.pointerId); });
svg.addEventListener('pointermove', e => { if (!pan) return; const s = pan.box.w / svg.clientWidth; svg.setAttribute('viewBox', \`\${pan.box.x-(e.clientX-pan.x)*s} \${pan.box.y-(e.clientY-pan.y)*s} \${pan.box.w} \${pan.box.h}\`); });
svg.addEventListener('pointerup', () => { pan = undefined; });
svg.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.12 : 0.89); }, { passive: false });
</script>
</body></html>`;
}



