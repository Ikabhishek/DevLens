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
            category: categoryFor(file),
            sizeBytes: data.project.files.find(projectFile => projectFile.relativePath === file)?.sizeBytes ?? 0,
            language: data.project.files.find(projectFile => projectFile.relativePath === file)?.language ?? 'Unknown'
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
.brand { display: flex; gap: 16px; align-items: center; } .logo { display: grid; place-items: center; width: 60px; height: 60px; padding: 4px; border: 0; border-radius: 0; background: transparent; } .logo img { width: 100%; height: 100%; filter: invert(1); }
h1 { margin: 0; font-size: 26px; } h2 { font-size: 17px; margin: 0 0 14px; } p { margin: 6px 0 0; } .muted { color: var(--vscode-descriptionForeground); }
.project-meta { text-align: right; } .project-meta strong { font-size: 16px; } button { font: inherit; cursor: pointer; }
.refresh { border: 0; padding: 9px 14px; border-radius: 6px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); margin-top: 10px; } .refresh:hover { background: var(--vscode-button-hoverBackground); }
.stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 10px 0; } .stat { padding: 10px 12px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editor-background); } .stat strong { display: block; font-size: 20px; color: var(--vscode-textLink-foreground); } .stat span { color: var(--vscode-descriptionForeground); font-size: 12px; }
.grid { display: grid; grid-template-columns: minmax(280px, 1fr) minmax(280px, 1fr); gap: 16px; } .panel { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 18px; background: var(--vscode-sideBar-background); min-width: 0; }
.language-layout { display: flex; align-items: center; gap: 24px; } .donut { width: 138px; height: 138px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 50%; background: conic-gradient(${segments || '#64748b 0 100%'}); } .donut::after { content: '${data.project.totalFiles}\\A Files'; white-space: pre; display: grid; place-items: center; width: 94px; height: 94px; border-radius: 50%; background: var(--vscode-sideBar-background); text-align: center; font-size: 13px; font-weight: 600; }
.language-list { flex: 1; min-width: 0; } .language-row { display: grid; grid-template-columns: 12px 1fr auto; align-items: center; gap: 8px; margin: 8px 0; font-size: 13px; } .color { width: 10px; height: 10px; border-radius: 50%; }
.chip-row { display: flex; flex-wrap: wrap; gap: 8px; } .chip { padding: 6px 9px; border-radius: 999px; background: color-mix(in srgb, var(--vscode-focusBorder) 22%, transparent); border: 1px solid var(--vscode-focusBorder); font-size: 12px; }
ul { margin: 0; padding-left: 18px; } li { margin: 8px 0; } .file-link { border: 0; background: transparent; padding: 0; color: var(--vscode-textLink-foreground); text-align: left; } .file-link:hover { text-decoration: underline; }
.workspace-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 0.9fr); gap: 12px; margin: 12px 0; align-items: stretch; } .architecture, .panel { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 14px; background: var(--vscode-sideBar-background); min-width: 0; } .architecture { margin: 0; } .architecture-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; } .architecture-heading p { margin: 0; font-size: 12px; }
#architecture-graph { display: block; width: 100%; height: 500px; margin-top: 8px; border-radius: 7px; background: var(--vscode-editor-background); cursor: grab; } #architecture-graph:active { cursor: grabbing; } .graph-legend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; font-size: 11px; color: var(--vscode-descriptionForeground); } .graph-legend span { display: inline-flex; align-items: center; gap: 6px; } .legend-dot { width: 9px; height: 9px; border-radius: 3px; }
.graph-controls { display: flex; align-items: center; gap: 6px; margin-top: 8px; } .graph-controls input { flex: 1; min-width: 100px; padding: 6px 8px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 5px; } .graph-controls button { padding: 5px 8px; color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); background: var(--vscode-button-secondaryBackground, var(--vscode-editor-background)); border: 1px solid var(--vscode-panel-border); border-radius: 5px; } .graph-controls button.active { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border-color: var(--vscode-focusBorder); } button:focus-visible, input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
.graph-node { cursor: pointer; } .graph-node:hover rect { stroke: var(--vscode-focusBorder); stroke-width: 3; } .graph-node.selected rect { stroke: var(--vscode-focusBorder); stroke-width: 4; } .graph-node.dimmed, .graph-edge.dimmed { opacity: .16; } .graph-edge { cursor: pointer; pointer-events: stroke; opacity: .8; } .graph-edge:hover, .graph-edge.highlighted { stroke-width: 4; opacity: 1; }
.detail-card { height: 100%; } .detail-card h2 { margin-bottom: 4px; } .detail-empty { color: var(--vscode-descriptionForeground); font-size: 13px; } .detail-row { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--vscode-panel-border); font-size: 12px; } .detail-row span:first-child { color: var(--vscode-descriptionForeground); } .detail-path { overflow-wrap: anywhere; margin: 9px 0; font-size: 12px; } .detail-actions { display: flex; gap: 6px; margin: 10px 0; flex-wrap: wrap; } .detail-actions button { border: 1px solid var(--vscode-panel-border); border-radius: 5px; color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 5px 8px; }
.actions { margin-top: 14px; } .action-grid { display: grid; grid-template-columns: repeat(2, minmax(200px, 1fr)); gap: 10px; } .action-card { display: flex; gap: 12px; align-items: center; width: 100%; min-height: 76px; border: 1px solid var(--vscode-panel-border); border-radius: 9px; padding: 12px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); text-align: left; } .action-card:hover { border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); } .action-icon { width: 30px; font-size: 22px; color: var(--vscode-textLink-foreground); text-align: center; } .action-card strong, .action-card small { display: block; } .action-card small { color: var(--vscode-descriptionForeground); margin-top: 4px; } .action-arrow { margin-left: auto; font-size: 26px; color: var(--vscode-descriptionForeground); }
@media (max-width: 900px) { body { padding: 16px; } .hero { align-items: flex-start; flex-direction: column; gap: 12px; } .project-meta { text-align: left; } .workspace-grid, .grid { grid-template-columns: 1fr; } #architecture-graph { height: 400px; } .action-grid { grid-template-columns: 1fr; } }
</style></head><body><main class="shell">
<section class="hero"><div class="brand"><div class="logo"><img src="${escapeHtml(logoUri)}" alt="DevLens"></div><div><h1>DevLens</h1><p class="muted">Understand your codebase through architecture and code relationships.</p></div></div><div class="project-meta"><strong>${escapeHtml(data.project.name)}</strong><p class="muted">Last scanned: ${escapeHtml(date)}</p><button class="refresh" id="refresh">Refresh dashboard</button></div></section>
<section class="workspace-grid"><article class="architecture"><div class="architecture-heading"><div><h2>Code architecture</h2><p class="muted">Resolved imports · select a node or edge · drag to pan</p></div><span class="muted">${graphData.nodes.length} connected files</span></div><div class="graph-controls"><input id="graph-search" type="search" placeholder="Search files…" aria-label="Search files in graph"><button id="zoom-out" title="Zoom out">−</button><button id="zoom-in" title="Zoom in">+</button><button id="fit-graph">Fit</button><button id="highlight-deps">Highlight dependencies</button></div><svg id="architecture-graph" role="img" aria-label="Interactive project architecture graph"></svg><div class="graph-legend"><span><i class="legend-dot" style="background:#2dd4bf"></i>Component</span><span><i class="legend-dot" style="background:#38bdf8"></i>Page / entry</span><span><i class="legend-dot" style="background:#fb923c"></i>Service / utility</span><span><i class="legend-dot" style="background:#a78bfa"></i>Module</span></div></article>
<aside class="panel detail-card"><h2>File Structure</h2><p class="muted">Workspace overview</p><div class="stats"><div class="stat"><strong>${data.project.totalFiles}</strong><span>Files</span></div><div class="stat"><strong>${data.project.totalFolders}</strong><span>Folders</span></div><div class="stat"><strong>${formatSize(data.project.totalSizeBytes)}</strong><span>Total size</span></div><div class="stat"><strong>${visibleEdges.length}</strong><span>Dependencies</span></div></div><h2>Selected file</h2><div id="selected-file-details" class="detail-empty">Select a graph node to inspect its imports, dependents, language, and file size.</div><h2 style="margin-top:16px">Selected connection</h2><div id="selected-edge-details" class="detail-empty">Select an edge to see which symbols it imports.</div></aside></section>
<section class="grid"><article class="panel"><h2>Languages</h2><div class="language-layout"><div class="donut"></div><div class="language-list">${languages.map(language => `<div class="language-row"><span class="color" style="background:${language.color}"></span><span>${escapeHtml(language.name)}</span><span>${language.count} (${language.percentage.toFixed(1)}%)</span></div>`).join('')}</div></div></article><article class="panel"><h2>Project analysis</h2><div class="stats"><div class="stat"><strong>${data.ast.totals.functions}</strong><span>Functions</span></div><div class="stat"><strong>${data.ast.totals.classes}</strong><span>Classes</span></div><div class="stat"><strong>${data.ast.totals.calls}</strong><span>Calls</span></div><div class="stat"><strong>${data.project.configFiles.length}</strong><span>Config files</span></div></div><h2>Detected technologies</h2><div class="chip-row">${architecture}</div></article><article class="panel"><h2>Configuration files</h2><ul>${configFiles}</ul></article><article class="panel"><h2>Most connected modules</h2><ul>${mostConnected(data.graph).map(item => `<li><button class="file-link" data-file="${escapeHtml(item.file)}">${escapeHtml(item.file)}</button> <span class="muted">${item.count} local connections</span></li>`).join('') || '<li class="muted">No local import connections yet.</li>'}</ul></article></section>
<section class="actions"><h2>DevLens tools</h2><div class="action-grid">${actionCards}</div></section>
</main><script>
const vscode = acquireVsCodeApi();
const graphData = ${graphDataJson};
const graph = document.getElementById('architecture-graph');
const colors = { component: '#2dd4bf', page: '#38bdf8', utility: '#fb923c', module: '#a78bfa' };
const escapeXml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let selectedFile; let highlightDependencies = false;
const detailFile = document.getElementById('selected-file-details');
const detailEdge = document.getElementById('selected-edge-details');
const selectFile = file => {
    selectedFile = file;
    const node = graphData.nodes.find(item => item.id === file);
    if (!node) return;
    const outgoing = graphData.edges.filter(edge => edge.from === file);
    const incoming = graphData.edges.filter(edge => edge.to === file);
    detailFile.innerHTML = '<div class="detail-path">' + escapeXml(node.id) + '</div><div class="detail-row"><span>Language</span><strong>' + escapeXml(node.language) + '</strong></div><div class="detail-row"><span>Size</span><strong>' + Math.max(1, Math.round(node.sizeBytes / 1024)) + ' KB</strong></div><div class="detail-row"><span>Imports</span><strong>' + outgoing.length + '</strong></div><div class="detail-row"><span>Imported by</span><strong>' + incoming.length + '</strong></div><div class="detail-actions"><button id="open-selected-file">Open file</button><button id="show-file-edges">Show imports</button></div>';
    detailFile.querySelector('#open-selected-file').addEventListener('click', () => vscode.postMessage({ command: 'openFile', filePath: file }));
    detailFile.querySelector('#show-file-edges').addEventListener('click', () => {
        detailEdge.innerHTML = outgoing.length
            ? outgoing.map(edge => '<div class="detail-row"><span>' + escapeXml(edge.to) + '</span><button class="edge-detail-button" data-edge="' + graphData.edges.indexOf(edge) + '">Symbols</button></div>').join('')
            : '<span class="detail-empty">No outgoing imports.</span>';
        detailEdge.querySelectorAll('.edge-detail-button').forEach(button => button.addEventListener('click', () => selectEdge(Number(button.dataset.edge))));
    });
    updateSelection();
};
const selectEdge = index => {
    const edge = graphData.edges[index];
    if (!edge) return;
    const names = edge.names.length ? edge.names.map(escapeXml).join(', ') : 'Module import (no named symbols)';
    detailEdge.innerHTML = '<div class="detail-path">' + escapeXml(edge.from) + ' → ' + escapeXml(edge.to) + '</div><div class="detail-row"><span>Imported symbols</span><strong>' + names + '</strong></div><div class="detail-actions"><button id="open-edge-target">Open imported file</button></div>';
    detailEdge.querySelector('#open-edge-target').addEventListener('click', () => vscode.postMessage({ command: 'openFile', filePath: edge.to }));
};
const updateSelection = () => {
    graph.querySelectorAll('.graph-node').forEach(node => {
        const isSelected = node.dataset.file === selectedFile;
        const isDependency = graphData.edges.some(edge => edge.from === selectedFile && edge.to === node.dataset.file);
        node.classList.toggle('selected', isSelected);
        node.classList.toggle('dimmed', highlightDependencies && !!selectedFile && !isSelected && !isDependency);
    });
    graph.querySelectorAll('.graph-edge').forEach(edgeElement => {
        const edge = graphData.edges[Number(edgeElement.dataset.edge)];
        const related = !!selectedFile && edge.from === selectedFile;
        edgeElement.classList.toggle('highlighted', highlightDependencies && related);
        edgeElement.classList.toggle('dimmed', highlightDependencies && !!selectedFile && !related);
    });
};
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
    const edges = graphData.edges.map((edge,index) => { const from = positions.get(edge.from), to = positions.get(edge.to), target = nodeById.get(edge.to); if (!from || !to || !target) return ''; const control = Math.max(36, (to.y - from.y) / 2); const title = edge.names.length ? 'Imports: ' + edge.names.join(', ') : 'Imports module'; return '<path class="graph-edge" data-edge="' + index + '" d="M ' + from.x + ' ' + (from.y + 25) + ' C ' + from.x + ' ' + (from.y + control) + ', ' + to.x + ' ' + (to.y - control) + ', ' + to.x + ' ' + (to.y - 25) + '" stroke="' + colors[target.category] + '" fill="none" stroke-width="2" marker-end="url(#arrow-' + target.category + ')"><title>' + escapeXml(title) + '</title></path>'; }).join('');
    const nodes = graphData.nodes.map(node => { const point = positions.get(node.id); const label = node.label.length > 24 ? node.label.slice(0, 21) + '…' : node.label; return '<g class="graph-node" data-file="' + escapeXml(node.id) + '" transform="translate(' + (point.x - 88) + ' ' + (point.y - 25) + ')" tabindex="0" role="button"><rect width="176" height="50" rx="8" fill="var(--vscode-sideBar-background)" stroke="' + colors[node.category] + '" stroke-width="2"></rect><text x="12" y="21" fill="' + colors[node.category] + '" font-size="11" font-weight="700">' + escapeXml(node.extension || 'FILE') + '</text><text x="44" y="32" fill="var(--vscode-foreground)" font-size="14">' + escapeXml(label) + '</text><title>Select ' + escapeXml(node.id) + '</title></g>'; }).join('');
    graph.setAttribute('viewBox', '0 0 ' + width + ' ' + height); graph.dataset.initialViewBox = '0 0 ' + width + ' ' + height; graph.innerHTML = '<defs>' + markers + '</defs>' + edges + nodes;
    graph.querySelectorAll('.graph-node').forEach(node => { const select = () => selectFile(node.dataset.file); node.addEventListener('click', select); node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') select(); }); });
    graph.querySelectorAll('.graph-edge').forEach(edge => edge.addEventListener('click', event => { event.stopPropagation(); selectEdge(Number(edge.dataset.edge)); }));
};
renderArchitecture();
document.getElementById('graph-search').addEventListener('input', event => {
    const query = event.target.value.toLowerCase();
    graph.querySelectorAll('.graph-node').forEach(node => node.classList.toggle('dimmed', !!query && !node.dataset.file.toLowerCase().includes(query)));
});
document.getElementById('highlight-deps').addEventListener('click', event => {
    highlightDependencies = !highlightDependencies;
    event.currentTarget.classList.toggle('active', highlightDependencies);
    updateSelection();
});
const zoom = factor => {
    const box = graph.viewBox.baseVal;
    const width = box.width * factor, height = box.height * factor;
    graph.setAttribute('viewBox', (box.x - (width - box.width) / 2) + ' ' + (box.y - (height - box.height) / 2) + ' ' + width + ' ' + height);
};
document.getElementById('zoom-in').addEventListener('click', () => zoom(0.82));
document.getElementById('zoom-out').addEventListener('click', () => zoom(1.22));
document.getElementById('fit-graph').addEventListener('click', () => graph.setAttribute('viewBox', graph.dataset.initialViewBox));
let panStart; graph.addEventListener('pointerdown', event => { if (event.target.closest('.graph-node, .graph-edge')) return; const box = graph.viewBox.baseVal; panStart = { x: event.clientX, y: event.clientY, box: { x: box.x, y: box.y, width: box.width, height: box.height } }; graph.setPointerCapture(event.pointerId); }); graph.addEventListener('pointermove', event => { if (!panStart) return; const scale = panStart.box.width / graph.clientWidth; graph.setAttribute('viewBox', (panStart.box.x - (event.clientX - panStart.x) * scale) + ' ' + (panStart.box.y - (event.clientY - panStart.y) * scale) + ' ' + panStart.box.width + ' ' + panStart.box.height); }); graph.addEventListener('pointerup', () => { panStart = undefined; }); graph.addEventListener('wheel', event => { event.preventDefault(); zoom(event.deltaY > 0 ? 1.12 : 0.89); }, { passive: false });
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
