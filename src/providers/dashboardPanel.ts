import * as path from 'path';
import * as vscode from 'vscode';
import { ArchitectureModel } from '../analyzer/architectureAnalyzer';
import { AstAnalysis } from '../analyzer/astAnalyzer';
import { DependencyGraph } from '../graph/dependencyGraph';
import { ProjectModel } from '../models/projectModel';

export interface DashboardData {
    project: ProjectModel;
    ast: AstAnalysis;
    graph: DependencyGraph;
    architecture: ArchitectureModel;
}

export async function showDashboard(
    rootUri: vscode.Uri,
    extensionUri: vscode.Uri,
    loadDashboard: () => Promise<DashboardData>
): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
        'devlensDashboard',
        'DevLens: Project Dashboard',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')]
        }
    );

    const render = async (): Promise<void> => {
        const logoUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, 'resources', 'devlens.svg')
        ).toString();
        panel.webview.html = getWebviewContent(await loadDashboard(), logoUri, panel.webview.cspSource);
    };
    await render();

    const commandIds = new Set([
        'devlens.analyzeProject',
        'devlens.visualizeArchitecture',
        'devlens.exploreRelationships',
        'devlens.explainCode',
        'devlens.analyzeImpact',
        'devlens.traceFlow',
        'devlens.detectArchitecture'
    ]);
    panel.webview.onDidReceiveMessage(async message => {
        if (message.command === 'refresh') {
            try {
                await render();
            } catch (error) {
                const details = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`DevLens dashboard refresh failed: ${details}`);
            }
            return;
        }
        if (message.command === 'runFeature' &&
            typeof message.feature === 'string' && commandIds.has(message.feature)) {
            await vscode.commands.executeCommand(message.feature);
            return;
        }
        if (message.command === 'openFile' && typeof message.filePath === 'string') {
            const filePath = path.posix.normalize(message.filePath.replace(/\\/g, '/'));
            if (path.posix.isAbsolute(filePath) || filePath === '..' || filePath.startsWith('../')) return;
            try {
                const document = await vscode.workspace.openTextDocument(
                    vscode.Uri.joinPath(rootUri, filePath)
                );
                await vscode.window.showTextDocument(document);
            } catch (error) {
                const details = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`DevLens could not open the file: ${details}`);
            }
        }
    });
}

function getWebviewContent(data: DashboardData, logoUri: string, cspSource: string): string {
    const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char] ?? char);
    const formatSize = (size: number): string => size >= 1024 * 1024
        ? `${(size / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.max(1, Math.round(size / 1024))} KB`;
    const date = new Date(data.project.scannedAt).toLocaleString();
    const totalLanguageFiles = Object.values(data.project.languageCounts)
        .reduce((total, count) => total + count, 0) || 1;
    const languageColors = ['#38bdf8', '#a78bfa', '#2dd4bf', '#fb923c', '#f472b6', '#94a3b8'];
    const languages = Object.entries(data.project.languageCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, count], index) => ({
            name,
            count,
            color: languageColors[index],
            percentage: (count / totalLanguageFiles) * 100
        }));
    let accumulated = 0;
    const segments = languages.map(language => {
        const start = accumulated;
        accumulated += language.percentage;
        return `${language.color} ${start.toFixed(2)}% ${accumulated.toFixed(2)}%`;
    }).join(', ');
    const cards = [
        ['↔', 'Relationships', 'Inspect callers and dependencies.', 'devlens.exploreRelationships'],
        ['?', 'Why Is This Here?', 'Explain a selected symbol’s role.', 'devlens.explainCode'],
        ['!', 'Impact Analysis', 'Identify files affected by change.', 'devlens.analyzeImpact'],
        ['→', 'Trace Flow', 'Follow calls, requests, and routes.', 'devlens.traceFlow']
    ];
    const architecture = data.architecture.components
        .map(component => `<span class="chip">${escapeHtml(component.name)}</span>`).join('') ||
        '<span class="muted">No supported technologies detected</span>';
    const configFiles = data.project.configFiles.length
        ? data.project.configFiles.map(file => `<li><button class="file-link" data-file="${escapeHtml(file)}">${escapeHtml(file)}</button></li>`).join('')
        : '<li class="muted">No configuration files detected.</li>';
    const actionCards = cards.map(([icon, title, description, command]) => `
        <button class="action-card" data-command="${command}">
            <span class="action-icon">${icon}</span>
            <span><strong>${title}</strong><small>${description}</small></span>
            <span class="action-arrow">›</span>
        </button>`).join('');
    const sourceExtensions = new Set([
        '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'
    ]);
    const isConfigFile = (file: string): boolean =>
        /(^|\/)(?:vite|webpack|eslint|prettier|jest|vitest|tailwind|postcss)\.config\./i.test(file);
    const visibleEdges = data.graph.edges.filter(edge =>
        sourceExtensions.has(path.posix.extname(edge.from).toLowerCase()) &&
        sourceExtensions.has(path.posix.extname(edge.to).toLowerCase()) &&
        !isConfigFile(edge.from) && !isConfigFile(edge.to)
    );
    const connectedFiles = new Set(visibleEdges.flatMap(edge => [edge.from, edge.to]));
    const categoryFor = (file: string): string => {
        const normalized = file.toLowerCase();
        const baseName = path.posix.basename(normalized);
        if (/(^|\/)(components?|widgets?)(\/|$)/.test(normalized)) return 'component';
        if (/(^|\/)(pages?|views?|routes?)(\/|$)/.test(normalized) || /^(app|main|index)\.(tsx|jsx|ts|js)$/.test(baseName)) return 'page';
        if (/(^|\/)(services?|utils?|helpers?|lib)(\/|$)/.test(normalized) || /api\.(tsx|jsx|ts|js)$/.test(baseName)) return 'utility';
        return 'module';
    };
    const graphData = {
        nodes: [...connectedFiles].sort().map(file => ({
            id: file,
            label: path.posix.basename(file),
            extension: path.posix.extname(file).slice(1).toUpperCase(),
            category: categoryFor(file)
        })),
        edges: visibleEdges.map(edge => ({ from: edge.from, to: edge.to, names: edge.importedNames }))
    };
    const graphDataJson = JSON.stringify(graphData)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026');

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
:root { color-scheme: dark light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 28px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
.shell { max-width: 1280px; margin: 0 auto; }
.hero { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 24px; border: 1px solid var(--vscode-panel-border); border-radius: 14px; background: linear-gradient(120deg, color-mix(in srgb, var(--vscode-focusBorder) 15%, var(--vscode-editor-background)), var(--vscode-editor-background)); }
.brand { display: flex; gap: 16px; align-items: center; } .logo { display: grid; place-items: center; width: 60px; height: 60px; padding: 8px; border: 1px solid var(--vscode-focusBorder); border-radius: 16px; background: color-mix(in srgb, var(--vscode-focusBorder) 15%, var(--vscode-sideBar-background)); } .logo img { width: 100%; height: 100%; filter: invert(1); }
h1 { margin: 0; font-size: 26px; } h2 { font-size: 17px; margin: 0 0 14px; } p { margin: 6px 0 0; } .muted { color: var(--vscode-descriptionForeground); }
.project-meta { text-align: right; } .project-meta strong { font-size: 16px; } button { font: inherit; cursor: pointer; }
.refresh { border: 0; padding: 9px 14px; border-radius: 6px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); margin-top: 10px; } .refresh:hover { background: var(--vscode-button-hoverBackground); }
.stats { display: grid; grid-template-columns: repeat(5, minmax(130px, 1fr)); gap: 12px; margin: 16px 0; } .stat { padding: 14px; border: 1px solid var(--vscode-panel-border); border-radius: 10px; background: var(--vscode-sideBar-background); } .stat strong { display: block; font-size: 24px; color: var(--vscode-textLink-foreground); } .stat span { color: var(--vscode-descriptionForeground); font-size: 12px; }
.grid { display: grid; grid-template-columns: minmax(280px, 1fr) minmax(280px, 1fr); gap: 16px; } .panel { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 18px; background: var(--vscode-sideBar-background); min-width: 0; }
.language-layout { display: flex; align-items: center; gap: 24px; } .donut { width: 138px; height: 138px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 50%; background: conic-gradient(${segments || '#64748b 0 100%'}); } .donut::after { content: '${data.project.totalFiles}\\A Files'; white-space: pre; display: grid; place-items: center; width: 94px; height: 94px; border-radius: 50%; background: var(--vscode-sideBar-background); text-align: center; font-size: 13px; font-weight: 600; }
.language-list { flex: 1; min-width: 0; } .language-row { display: grid; grid-template-columns: 12px 1fr auto; align-items: center; gap: 8px; margin: 8px 0; font-size: 13px; } .color { width: 10px; height: 10px; border-radius: 50%; }
.chip-row { display: flex; flex-wrap: wrap; gap: 8px; } .chip { padding: 6px 9px; border-radius: 999px; background: color-mix(in srgb, var(--vscode-focusBorder) 22%, transparent); border: 1px solid var(--vscode-focusBorder); font-size: 12px; }
ul { margin: 0; padding-left: 18px; } li { margin: 8px 0; } .file-link { border: 0; background: transparent; padding: 0; color: var(--vscode-textLink-foreground); text-align: left; } .file-link:hover { text-decoration: underline; }
.architecture { margin: 0 0 16px; padding: 18px; border: 1px solid var(--vscode-panel-border); border-radius: 12px; background: var(--vscode-sideBar-background); } .architecture-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; } .architecture-heading p { margin: 0; font-size: 12px; }
#architecture-graph { display: block; width: 100%; height: 420px; margin-top: 12px; border-radius: 8px; background: var(--vscode-editor-background); cursor: grab; } #architecture-graph:active { cursor: grabbing; } .graph-legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 10px; font-size: 12px; color: var(--vscode-descriptionForeground); } .graph-legend span { display: inline-flex; align-items: center; gap: 6px; } .legend-dot { width: 10px; height: 10px; border-radius: 3px; }
.actions { margin-top: 16px; } .action-grid { display: grid; grid-template-columns: repeat(2, minmax(200px, 1fr)); gap: 12px; } .action-card { display: flex; gap: 12px; align-items: center; width: 100%; min-height: 82px; border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 14px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); text-align: left; } .action-card:hover { border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); } .action-icon { width: 30px; font-size: 24px; color: #38bdf8; text-align: center; } .action-card strong, .action-card small { display: block; } .action-card small { color: var(--vscode-descriptionForeground); margin-top: 4px; } .action-arrow { margin-left: auto; font-size: 28px; color: var(--vscode-descriptionForeground); }
@media (max-width: 820px) { body { padding: 16px; } .hero { align-items: flex-start; flex-direction: column; } .project-meta { text-align: left; } .stats { grid-template-columns: repeat(2, 1fr); } .grid { grid-template-columns: 1fr; } .action-grid { grid-template-columns: 1fr; } }
</style></head><body><main class="shell">
<section class="hero"><div class="brand"><div class="logo"><img src="${escapeHtml(logoUri)}" alt="DevLens"></div><div><h1>DevLens</h1><p class="muted">Understand your codebase through architecture and code relationships.</p></div></div><div class="project-meta"><strong>${escapeHtml(data.project.name)}</strong><p class="muted">Last scanned: ${escapeHtml(date)}</p><button class="refresh" id="refresh">Refresh dashboard</button></div></section>
<section class="stats"><div class="stat"><strong>${data.project.totalFiles}</strong><span>Files</span></div><div class="stat"><strong>${data.project.totalFolders}</strong><span>Folders</span></div><div class="stat"><strong>${formatSize(data.project.totalSizeBytes)}</strong><span>Total size</span></div><div class="stat"><strong>${Object.keys(data.project.languageCounts).length}</strong><span>Languages</span></div><div class="stat"><strong>${data.graph.edges.length}</strong><span>Dependencies</span></div></section>
<section class="architecture"><div class="architecture-heading"><div><h2>Code architecture</h2><p class="muted">Resolved local imports · click a node to open its file · scroll to zoom · drag to pan</p></div><span class="muted">${graphData.nodes.length} connected code files</span></div><svg id="architecture-graph" role="img" aria-label="Interactive project architecture graph"></svg><div class="graph-legend"><span><i class="legend-dot" style="background:#2dd4bf"></i>Component</span><span><i class="legend-dot" style="background:#38bdf8"></i>Page / entry</span><span><i class="legend-dot" style="background:#fb923c"></i>Service / utility</span><span><i class="legend-dot" style="background:#a78bfa"></i>Module</span></div></section>
<section class="grid"><article class="panel"><h2>Languages</h2><div class="language-layout"><div class="donut"></div><div class="language-list">${languages.map(language => `<div class="language-row"><span class="color" style="background:${language.color}"></span><span>${escapeHtml(language.name)}</span><span>${language.count} (${language.percentage.toFixed(1)}%)</span></div>`).join('')}</div></div></article><article class="panel"><h2>Project analysis</h2><div class="stats" style="grid-template-columns:repeat(2,1fr);margin:0 0 16px"><div class="stat"><strong>${data.ast.totals.functions}</strong><span>Functions</span></div><div class="stat"><strong>${data.ast.totals.classes}</strong><span>Classes</span></div><div class="stat"><strong>${data.ast.totals.calls}</strong><span>Calls</span></div><div class="stat"><strong>${data.project.configFiles.length}</strong><span>Config files</span></div></div><h2>Detected technologies</h2><div class="chip-row">${architecture}</div></article><article class="panel"><h2>Configuration files</h2><ul>${configFiles}</ul></article><article class="panel"><h2>Most connected modules</h2><ul>${mostConnected(data.graph).map(item => `<li><button class="file-link" data-file="${escapeHtml(item.file)}">${escapeHtml(item.file)}</button> <span class="muted">${item.count} local connections</span></li>`).join('') || '<li class="muted">No local import connections yet.</li>'}</ul></article></section>
<section class="actions"><h2>DevLens tools</h2><div class="action-grid">${actionCards}</div></section>
</main><script>
const vscode = acquireVsCodeApi();
const graphData = ${graphDataJson};
const graph = document.getElementById('architecture-graph');
const colors = { component: '#2dd4bf', page: '#38bdf8', utility: '#fb923c', module: '#a78bfa' };
const escapeXml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const renderArchitecture = () => {
    if (!graphData.nodes.length) {
        graph.setAttribute('viewBox', '0 0 800 220');
        graph.innerHTML = '<text x="400" y="110" text-anchor="middle" fill="var(--vscode-descriptionForeground)">No resolved local code connections found.</text>';
        return;
    }
    const nodeById = new Map(graphData.nodes.map(node => [node.id, node]));
    const incoming = new Map(graphData.nodes.map(node => [node.id, 0]));
    const outgoing = new Map(graphData.nodes.map(node => [node.id, []]));
    graphData.edges.forEach(edge => { if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) return; incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1); outgoing.get(edge.from).push(edge.to); });
    const levels = new Map();
    const queue = graphData.nodes.filter(node => (incoming.get(node.id) || 0) === 0).map(node => node.id);
    queue.forEach(id => levels.set(id, 0));
    while (queue.length) { const id = queue.shift(); const level = levels.get(id) || 0; (outgoing.get(id) || []).forEach(next => { incoming.set(next, (incoming.get(next) || 0) - 1); levels.set(next, Math.max(levels.get(next) || 0, level + 1)); if ((incoming.get(next) || 0) === 0) queue.push(next); }); }
    graphData.nodes.forEach(node => { if (!levels.has(node.id)) levels.set(node.id, 0); });
    const layers = new Map(); graphData.nodes.forEach(node => { const level = levels.get(node.id) || 0; const layer = layers.get(level) || []; layer.push(node); layers.set(level, layer); });
    const widest = Math.max(1, ...[...layers.values()].map(layer => layer.length)); const width = Math.max(820, widest * 220 + 80); const height = Math.max(300, layers.size * 145 + 70); const positions = new Map();
    [...layers.entries()].sort((a,b) => a[0] - b[0]).forEach(([level, layer]) => { layer.sort((a,b) => a.label.localeCompare(b.label)); const spacing = width / (layer.length + 1); layer.forEach((node,index) => positions.set(node.id, { x: spacing * (index + 1), y: 46 + level * 145 })); });
    const markers = Object.entries(colors).map(([kind,color]) => '<marker id="arrow-' + kind + '" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="' + color + '"></path></marker>').join('');
    const edges = graphData.edges.map(edge => { const from = positions.get(edge.from), to = positions.get(edge.to), target = nodeById.get(edge.to); if (!from || !to || !target) return ''; const control = Math.max(36, (to.y - from.y) / 2); const title = edge.names.length ? 'Imports: ' + edge.names.join(', ') : 'Imports module'; return '<path d="M ' + from.x + ' ' + (from.y + 25) + ' C ' + from.x + ' ' + (from.y + control) + ', ' + to.x + ' ' + (to.y - control) + ', ' + to.x + ' ' + (to.y - 25) + '" stroke="' + colors[target.category] + '" fill="none" stroke-width="2" marker-end="url(#arrow-' + target.category + ')"><title>' + escapeXml(title) + '</title></path>'; }).join('');
    const nodes = graphData.nodes.map(node => { const point = positions.get(node.id); const label = node.label.length > 24 ? node.label.slice(0, 21) + '…' : node.label; return '<g class="graph-node" data-file="' + escapeXml(node.id) + '" transform="translate(' + (point.x - 88) + ' ' + (point.y - 25) + ')" tabindex="0" role="button"><rect width="176" height="50" rx="8" fill="var(--vscode-sideBar-background)" stroke="' + colors[node.category] + '" stroke-width="2"></rect><text x="12" y="21" fill="' + colors[node.category] + '" font-size="11" font-weight="700">' + escapeXml(node.extension || 'FILE') + '</text><text x="44" y="32" fill="var(--vscode-foreground)" font-size="14">' + escapeXml(label) + '</text><title>Open ' + escapeXml(node.id) + '</title></g>'; }).join('');
    graph.setAttribute('viewBox', '0 0 ' + width + ' ' + height); graph.dataset.initialViewBox = '0 0 ' + width + ' ' + height; graph.innerHTML = '<defs>' + markers + '</defs>' + edges + nodes;
    graph.querySelectorAll('.graph-node').forEach(node => { const open = () => vscode.postMessage({ command: 'openFile', filePath: node.dataset.file }); node.addEventListener('click', open); node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') open(); }); });
};
renderArchitecture();
let panStart; graph.addEventListener('pointerdown', event => { const box = graph.viewBox.baseVal; panStart = { x: event.clientX, y: event.clientY, box: { x: box.x, y: box.y, width: box.width, height: box.height } }; graph.setPointerCapture(event.pointerId); }); graph.addEventListener('pointermove', event => { if (!panStart) return; const scale = panStart.box.width / graph.clientWidth; graph.setAttribute('viewBox', (panStart.box.x - (event.clientX - panStart.x) * scale) + ' ' + (panStart.box.y - (event.clientY - panStart.y) * scale) + ' ' + panStart.box.width + ' ' + panStart.box.height); }); graph.addEventListener('pointerup', () => { panStart = undefined; }); graph.addEventListener('wheel', event => { event.preventDefault(); const box = graph.viewBox.baseVal; const factor = event.deltaY > 0 ? 1.12 : 0.89; const width = Math.max(240, box.width * factor), height = Math.max(160, box.height * factor); graph.setAttribute('viewBox', (box.x - (width - box.width) / 2) + ' ' + (box.y - (height - box.height) / 2) + ' ' + width + ' ' + height); }, { passive: false });
document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({command:'refresh'})); document.querySelectorAll('.action-card').forEach(button => button.addEventListener('click', () => vscode.postMessage({command:'runFeature', feature:button.dataset.command}))); document.querySelectorAll('.file-link').forEach(button => button.addEventListener('click', () => vscode.postMessage({command:'openFile', filePath:button.dataset.file})));
</script></body></html>`;
}

function mostConnected(graph: DependencyGraph): Array<{ file: string; count: number }> {
    const counts = new Map<string, number>();
    for (const edge of graph.edges) {
        counts.set(edge.from, (counts.get(edge.from) ?? 0) + 1);
        counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([file, count]) => ({ file, count }))
        .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
        .slice(0, 5);
}
