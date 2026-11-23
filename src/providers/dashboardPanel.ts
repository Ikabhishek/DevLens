import * as path from 'path';
import * as vscode from 'vscode';
import { ArchitectureModel } from '../analyzer/architectureAnalyzer';
import { AstAnalysis } from '../analyzer/astAnalyzer';
import { DependencyGraph } from '../graph/dependencyGraph';
import { ProjectModel } from '../models/projectModel';
import { generateDevLensPdfReport } from '../report/pdfReportGenerator';

export interface DashboardData {
    project: ProjectModel;
    ast: AstAnalysis;
    graph: DependencyGraph;
    architecture: ArchitectureModel;
}

let activeDashboardInstance: {
    panel: vscode.WebviewPanel;
    render: (forceRescan?: boolean) => Promise<void>;
} | undefined;

export function refreshActiveDashboard(): void {
    if (activeDashboardInstance) {
        void activeDashboardInstance.render();
    }
}

export async function showDashboard(
    rootUri: vscode.Uri,
    extensionUri: vscode.Uri,
    loadDashboard: (forceRescan?: boolean) => Promise<DashboardData>
): Promise<void> {
    if (activeDashboardInstance) {
        activeDashboardInstance.panel.reveal();
        await activeDashboardInstance.render();
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        'devlensDashboard',
        'DevLens: Project Dashboard',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')]
        }
    );

    const render = async (forceRescan = false): Promise<void> => {
        const logoUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, 'resources', 'devlens.svg')
        ).toString();
        panel.webview.html = getWebviewContent(
            await loadDashboard(forceRescan),
            logoUri,
            panel.webview.cspSource
        );
    };

    activeDashboardInstance = { panel, render };
    panel.onDidDispose(() => {
        if (activeDashboardInstance?.panel === panel) {
            activeDashboardInstance = undefined;
        }
    });

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
                await render(true);
            } catch (error) {
                const details = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`DevLens dashboard refresh failed: ${details}`);
            }
            return;
        }
        if (message.command === 'downloadReport') {
            const reportData = await loadDashboard();
            const fileName = `${reportData.project.name.replace(/[^a-z0-9_-]/gi, '-') || 'project'}-devlens-report.pdf`;
            const destination = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.joinPath(rootUri, fileName),
                filters: { 'PDF documents': ['pdf'] },
                saveLabel: 'Download report'
            });
            if (!destination) return;
            try {
                await vscode.workspace.fs.writeFile(destination, generateDevLensPdfReport(reportData));
                vscode.window.showInformationMessage(`DevLens: Project report saved to ${destination.fsPath}`);
            } catch (error) {
                const details = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`DevLens could not save the project report: ${details}`);
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
    const frameworkCoverage = [
        [data.ast.totals.angularComponents, 'Angular components'],
        [data.ast.totals.angularServices, 'Angular services'],
        [data.ast.totals.angularRoutes, 'Angular routes'],
        [data.ast.totals.expressControllers, 'Express controllers'],
        [data.ast.totals.mongooseModels, 'Mongoose models']
    ].filter(([count]) => Number(count) > 0)
        .map(([count, label]) => `${count} ${label}`).join(' · ');
    const sourceExtensions = new Set([
        '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs',
        '.html', '.htm', '.css', '.scss', '.sass', '.less'
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
        if (/(^|\/)(components?|widgets?)(\/|$)/.test(normalized) || /\.component\.(ts|tsx|js|jsx)$/.test(baseName)) return 'component';
        if (/\.(html|htm)$/.test(baseName)) return 'page';
        if (/\.(css|scss|sass|less)$/.test(baseName)) return 'utility';
        if (/(^|\/)(pages?|views?|routes?)(\/|$)/.test(normalized) || /^(app|main|index)\.(tsx|jsx|ts|js)$/.test(baseName)) return 'page';
        if (/(^|\/)(services?|utils?|helpers?|lib|controllers?|models?|schemas?)(\/|$)/.test(normalized) ||
            /\.(service|controller|model|schema)\.(ts|tsx|js|jsx)$/.test(baseName) ||
            /api\.(tsx|jsx|ts|js)$/.test(baseName)) return 'utility';
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
    const categoryCounts = {
        all: graphData.nodes.length,
        component: graphData.nodes.filter(node => node.category === 'component').length,
        page: graphData.nodes.filter(node => node.category === 'page').length,
        utility: graphData.nodes.filter(node => node.category === 'utility').length,
        module: graphData.nodes.filter(node => node.category === 'module').length
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
body { margin: 0; padding: 24px 28px 40px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
.shell { max-width: 1280px; margin: 0 auto; }
.breadcrumb { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 14px; }
.bc-sep { opacity: .4; }
.bc-current { color: var(--vscode-foreground); font-weight: 600; }
.hero { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 22px 24px; border: 1px solid var(--vscode-panel-border); border-radius: 14px; background: linear-gradient(120deg, color-mix(in srgb, var(--vscode-focusBorder) 15%, var(--vscode-editor-background)), var(--vscode-editor-background)); margin-bottom: 14px; }
.brand { display: flex; gap: 16px; align-items: center; } .logo { display: grid; place-items: center; width: 56px; height: 56px; padding: 4px; border: 0; border-radius: 0; background: transparent; } .logo img { width: 100%; height: 100%; filter: invert(1); }
h1 { margin: 0; font-size: 24px; } h2 { font-size: 16px; margin: 0 0 12px; } p { margin: 6px 0 0; } .muted { color: var(--vscode-descriptionForeground); }
.project-meta { text-align: right; } .project-meta strong { font-size: 16px; } .hero-actions { display: flex; justify-content: flex-end; gap: 8px; } button { font: inherit; cursor: pointer; }
.refresh { border: 0; padding: 8px 14px; border-radius: 6px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); margin-top: 10px; font-weight: 500; } .refresh:hover { background: var(--vscode-button-hoverBackground); }
.report-download { border: 1px solid var(--vscode-button-border, var(--vscode-focusBorder)); padding: 8px 14px; border-radius: 6px; color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); background: var(--vscode-button-secondaryBackground, var(--vscode-editor-background)); margin-top: 10px; font-weight: 500; } .report-download:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
.stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 10px 0; } .stat { padding: 10px 12px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editor-background); } .stat strong { display: block; font-size: 20px; color: var(--vscode-textLink-foreground); } .stat span { color: var(--vscode-descriptionForeground); font-size: 12px; }
.grid { display: grid; grid-template-columns: minmax(280px, 1fr) minmax(280px, 1fr); gap: 14px; } .panel { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 16px; background: var(--vscode-sideBar-background); min-width: 0; }
.language-layout { display: flex; align-items: center; gap: 24px; } .donut { width: 138px; height: 138px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 50%; background: conic-gradient(${segments || '#64748b 0 100%'}); } .donut::after { content: '${data.project.totalFiles}\\A Files'; white-space: pre; display: grid; place-items: center; width: 94px; height: 94px; border-radius: 50%; background: var(--vscode-sideBar-background); text-align: center; font-size: 13px; font-weight: 600; }
.language-list { flex: 1; min-width: 0; } .language-row { display: grid; grid-template-columns: 12px 1fr auto; align-items: center; gap: 8px; margin: 8px 0; font-size: 13px; } .color { width: 10px; height: 10px; border-radius: 50%; }
.chip-row { display: flex; flex-wrap: wrap; gap: 8px; } .chip { padding: 5px 9px; border-radius: 999px; background: color-mix(in srgb, var(--vscode-focusBorder) 22%, transparent); border: 1px solid var(--vscode-focusBorder); font-size: 12px; }
ul { margin: 0; padding-left: 18px; } li { margin: 8px 0; } .file-link { border: 0; background: transparent; padding: 0; color: var(--vscode-textLink-foreground); text-align: left; } .file-link:hover { text-decoration: underline; }
.workspace-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 0.9fr); gap: 14px; margin: 0 0 14px; align-items: stretch; } .architecture { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 16px; background: var(--vscode-sideBar-background); min-width: 0; margin: 0; } .architecture-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; } .architecture-heading p { margin: 0; font-size: 12px; }
.category-filters { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 6px; }
.filter-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); color: var(--vscode-foreground); font-size: 11px; cursor: pointer; transition: all .12s; }
.filter-pill:hover { border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); }
.filter-pill.active { border-color: var(--vscode-focusBorder); background: color-mix(in srgb, var(--vscode-focusBorder) 22%, var(--vscode-sideBar-background)); font-weight: 600; }
.pill-badge { font-size: 10px; opacity: .75; min-width: 14px; text-align: center; }
#architecture-graph { display: block; width: 100%; height: 500px; margin-top: 10px; border-radius: 8px; background: var(--vscode-editor-background); cursor: grab; } #architecture-graph:active { cursor: grabbing; } .graph-legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 10px; font-size: 11px; color: var(--vscode-descriptionForeground); } .graph-legend span { display: inline-flex; align-items: center; gap: 6px; } .legend-dot { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
.graph-controls { display: flex; align-items: center; gap: 6px; margin-top: 8px; flex-wrap: wrap; } .graph-controls input { flex: 1; min-width: 120px; padding: 6px 9px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 6px; font-size: 12px; } .graph-controls button { padding: 5px 9px; color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); background: var(--vscode-button-secondaryBackground, var(--vscode-editor-background)); border: 1px solid var(--vscode-panel-border); border-radius: 6px; font-size: 12px; } .graph-controls button.active { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border-color: var(--vscode-focusBorder); } .graph-status { min-height: 16px; margin: 6px 0 0; color: var(--vscode-descriptionForeground); font-size: 11px; } button:focus-visible, input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
.graph-node { cursor: pointer; transition: opacity .2s ease; } .graph-node:hover rect { stroke: var(--vscode-focusBorder); stroke-width: 3; } .graph-node.selected rect { stroke: var(--vscode-focusBorder) !important; stroke-width: 4 !important; animation: graph-node-pulse 1.6s ease-in-out infinite; } .graph-node.search-matched rect { stroke: #38bdf8 !important; stroke-width: 3.5 !important; filter: drop-shadow(0 0 6px #38bdf8); } .graph-node.dependency-highlighted rect { stroke: #2dd4bf !important; stroke-width: 3.5 !important; } .graph-node.dimmed { opacity: .12 !important; pointer-events: none; } .graph-edge { cursor: pointer; pointer-events: stroke; opacity: .8; transition: opacity .2s ease, stroke-width .2s ease; } .graph-edge:hover, .graph-edge.highlighted { stroke-width: 4; opacity: 1 !important; } .graph-edge.flowing { stroke-dasharray: 8 8; stroke-width: 4; opacity: 1 !important; animation: graph-flow 1.1s linear infinite; } .graph-edge.dimmed { opacity: .04 !important; pointer-events: none; }
@keyframes graph-node-pulse { 50% { filter: brightness(1.35); } } @keyframes graph-flow { to { stroke-dashoffset: -32; } }
@media (prefers-reduced-motion: reduce) { .graph-node.selected rect, .graph-edge.flowing { animation: none; } }
.detail-card { height: 100%; } .detail-card h2 { margin-bottom: 4px; } .detail-empty { color: var(--vscode-descriptionForeground); font-size: 13px; line-height: 1.5; } .detail-row { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--vscode-panel-border); font-size: 12px; } .detail-row span:first-child { color: var(--vscode-descriptionForeground); } .detail-path { overflow-wrap: anywhere; margin: 9px 0; font-size: 12px; font-weight: 600; } .detail-actions { display: flex; gap: 6px; margin: 10px 0; flex-wrap: wrap; } .detail-actions button { border: 1px solid var(--vscode-panel-border); border-radius: 5px; color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 5px 8px; }
.actions { margin-top: 14px; } .action-grid { display: grid; grid-template-columns: repeat(2, minmax(200px, 1fr)); gap: 10px; } .action-card { display: flex; gap: 12px; align-items: center; width: 100%; min-height: 74px; border: 1px solid var(--vscode-panel-border); border-radius: 9px; padding: 12px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); text-align: left; } .action-card:hover { border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); } .action-icon { width: 30px; font-size: 22px; color: var(--vscode-textLink-foreground); text-align: center; } .action-card strong, .action-card small { display: block; } .action-card small { color: var(--vscode-descriptionForeground); margin-top: 4px; } .action-arrow { margin-left: auto; font-size: 26px; color: var(--vscode-descriptionForeground); }
@media (max-width: 900px) { body { padding: 16px; } .hero { align-items: flex-start; flex-direction: column; gap: 12px; } .project-meta { text-align: left; } .hero-actions { justify-content: flex-start; } .workspace-grid, .grid { grid-template-columns: 1fr; } #architecture-graph { height: 400px; } .action-grid { grid-template-columns: 1fr; } }
</style></head><body><main class="shell">
<nav class="breadcrumb">
  <span>DevLens</span>
  <span class="bc-sep">›</span>
  <span class="bc-current">Project Architecture & Dashboard</span>
</nav>
<section class="hero"><div class="brand"><div class="logo"><img src="${escapeHtml(logoUri)}" alt="DevLens"></div><div><h1>DevLens</h1><p class="muted">Understand your codebase through architecture and code relationships.</p></div></div><div class="project-meta"><strong>${escapeHtml(data.project.name)}</strong><p class="muted">Last scanned: ${escapeHtml(date)}</p><div class="hero-actions"><button class="report-download" id="download-report">Download PDF report</button><button class="refresh" id="refresh">Refresh dashboard</button></div></div></section>
<section class="workspace-grid"><article class="architecture"><div class="architecture-heading"><div><h2>Code architecture</h2><p class="muted">Resolved imports · select a node or edge · drag to pan</p></div><span class="muted">${graphData.nodes.length} connected files</span></div><div class="category-filters"><button class="filter-pill active" data-category="all">All <span class="pill-badge">${categoryCounts.all}</span></button><button class="filter-pill" data-category="component"><i class="legend-dot" style="background:#2dd4bf"></i>Components <span class="pill-badge">${categoryCounts.component}</span></button><button class="filter-pill" data-category="page"><i class="legend-dot" style="background:#38bdf8"></i>Pages / Entry <span class="pill-badge">${categoryCounts.page}</span></button><button class="filter-pill" data-category="utility"><i class="legend-dot" style="background:#fb923c"></i>Services / Utils <span class="pill-badge">${categoryCounts.utility}</span></button><button class="filter-pill" data-category="module"><i class="legend-dot" style="background:#a78bfa"></i>Modules <span class="pill-badge">${categoryCounts.module}</span></button></div><div class="graph-controls"><input id="graph-search" type="search" placeholder="Search files…" aria-label="Search files in graph"><button id="layout-toggle" title="Switch layout between Hierarchical Layers and Group by Type">Layout: Hierarchical</button><button id="zoom-out" title="Zoom out">−</button><button id="zoom-in" title="Zoom in">+</button><button id="fit-graph">Fit</button><button id="highlight-deps">Highlight dependencies</button></div><p id="graph-status" class="graph-status" role="status" aria-live="polite">Showing all connected files.</p><svg id="architecture-graph" role="img" aria-label="Interactive project architecture graph"></svg><div class="graph-legend"><span><i class="legend-dot" style="background:#2dd4bf"></i>Component</span><span><i class="legend-dot" style="background:#38bdf8"></i>Page / entry</span><span><i class="legend-dot" style="background:#fb923c"></i>Service / utility</span><span><i class="legend-dot" style="background:#a78bfa"></i>Module</span></div></article>
<aside class="panel detail-card"><h2>File Structure</h2><p class="muted">Workspace overview</p><div class="stats"><div class="stat"><strong>${data.project.totalFiles}</strong><span>Files</span></div><div class="stat"><strong>${data.project.totalFolders}</strong><span>Folders</span></div><div class="stat"><strong>${formatSize(data.project.totalSizeBytes)}</strong><span>Total size</span></div><div class="stat"><strong>${visibleEdges.length}</strong><span>Dependencies</span></div></div><h2>Selected file</h2><div id="selected-file-details" class="detail-empty">Select a graph node to inspect its imports, dependents, language, and file size.</div><h2 style="margin-top:16px">Selected connection</h2><div id="selected-edge-details" class="detail-empty">Select an edge to see which symbols it imports.</div></aside></section>
<section class="grid"><article class="panel"><h2>Languages</h2><div class="language-layout"><div class="donut"></div><div class="language-list">${languages.map(language => `<div class="language-row"><span class="color" style="background:${language.color}"></span><span>${escapeHtml(language.name)}</span><span>${language.count} (${language.percentage.toFixed(1)}%)</span></div>`).join('')}</div></div></article><article class="panel"><h2>Project analysis</h2><div class="stats"><div class="stat"><strong>${data.ast.totals.functions}</strong><span>Functions</span></div><div class="stat"><strong>${data.ast.totals.classes}</strong><span>Classes</span></div><div class="stat"><strong>${data.ast.totals.calls}</strong><span>Calls</span></div><div class="stat"><strong>${data.project.configFiles.length}</strong><span>Config files</span></div></div>${frameworkCoverage ? `<p class="muted">${escapeHtml(frameworkCoverage)}</p>` : ''}<h2>Detected technologies</h2><div class="chip-row">${architecture}</div></article><article class="panel"><h2>Configuration files</h2><ul>${configFiles}</ul></article><article class="panel"><h2>Most connected modules</h2><ul>${mostConnected(data.graph).map(item => `<li><button class="file-link" data-file="${escapeHtml(item.file)}">${escapeHtml(item.file)}</button> <span class="muted">${item.count} local connections</span></li>`).join('') || '<li class="muted">No local import connections yet.</li>'}</ul></article></section>
<section class="actions"><h2>DevLens tools</h2><div class="action-grid">${actionCards}</div></section>
</main><script>
const vscode = acquireVsCodeApi();
const graphData = ${graphDataJson};
const graph = document.getElementById('architecture-graph');
const colors = { component: '#2dd4bf', page: '#38bdf8', utility: '#fb923c', module: '#a78bfa' };
const escapeXml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let selectedFile;
let selectedEdge;
let highlightDependencies = false;
let activeCategory = 'all';
let currentLayout = 'hierarchical';

const detailFile = document.getElementById('selected-file-details');
const detailEdge = document.getElementById('selected-edge-details');
const selectFile = file => {
    selectedFile = file;
    selectedEdge = undefined;
    const node = graphData.nodes.find(item => item.id === file);
    if (!node) { return; }
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
    if (!edge) { return; }
    selectedEdge = index;
    const names = edge.names.length ? edge.names.map(escapeXml).join(', ') : 'Module import (no named symbols)';
    detailEdge.innerHTML = '<div class="detail-path">' + escapeXml(edge.from) + ' → ' + escapeXml(edge.to) + '</div><div class="detail-row"><span>Imported symbols</span><strong>' + names + '</strong></div><div class="detail-actions"><button id="open-edge-target">Open imported file</button></div>';
    detailEdge.querySelector('#open-edge-target').addEventListener('click', () => vscode.postMessage({ command: 'openFile', filePath: edge.to }));
    updateSelection();
};
const updateSelection = () => {
    const searchInput = document.getElementById('graph-search');
    const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
    let visibleCount = 0;

    graph.querySelectorAll('.graph-node').forEach(node => {
        const file = node.dataset.file;
        const nodeData = graphData.nodes.find(n => n.id === file);
        const isSelected = file === selectedFile;
        // Check both outgoing (e.from == selectedFile) and incoming (e.to == selectedFile) dependencies
        const isDependency = Boolean(selectedFile && graphData.edges.some(e =>
            (e.from === selectedFile && e.to === file) || (e.to === selectedFile && e.from === file)
        ));
        const matchesCategory = activeCategory === 'all' || (nodeData && nodeData.category === activeCategory);
        const matchesSearch = !query || file.toLowerCase().includes(query) || (nodeData && (nodeData.label.toLowerCase().includes(query) || (nodeData.extension && nodeData.extension.toLowerCase().includes(query))));

        node.classList.toggle('selected', isSelected);
        node.classList.toggle('search-matched', Boolean(query && matchesSearch));
        node.classList.toggle('dependency-highlighted', Boolean(highlightDependencies && selectedFile && isDependency));

        const dim = !matchesCategory || !matchesSearch || (highlightDependencies && Boolean(selectedFile) && !isSelected && !isDependency);
        node.classList.toggle('dimmed', dim);
        if (!dim) {
            visibleCount++;
        }
    });

    graph.querySelectorAll('.graph-edge').forEach(edgeElement => {
        const edge = graphData.edges[Number(edgeElement.dataset.edge)];
        const fromNode = graphData.nodes.find(n => n.id === edge?.from);
        const toNode = graphData.nodes.find(n => n.id === edge?.to);
        const related = Boolean(selectedFile && (edge?.from === selectedFile || edge?.to === selectedFile));

        const fromMatchesCategory = activeCategory === 'all' || fromNode?.category === activeCategory;
        const toMatchesCategory = activeCategory === 'all' || toNode?.category === activeCategory;
        const matchesCategory = fromMatchesCategory || toMatchesCategory;

        const fromMatchesSearch = !query || fromNode?.id.toLowerCase().includes(query);
        const toMatchesSearch = !query || toNode?.id.toLowerCase().includes(query);
        const matchesSearch = fromMatchesSearch || toMatchesSearch;

        const isSelected = Number(edgeElement.dataset.edge) === selectedEdge;
        edgeElement.classList.toggle('highlighted', (highlightDependencies && related) || isSelected);
        edgeElement.classList.toggle('flowing', (highlightDependencies && related) || isSelected);

        const dim = !matchesCategory || !matchesSearch || (highlightDependencies && Boolean(selectedFile) && !related);
        edgeElement.classList.toggle('dimmed', dim);
    });

    // Provide clear, immediate status message
    const filterInfo = [];
    if (activeCategory !== 'all') {
        filterInfo.push(activeCategory.toUpperCase());
    }
    if (query) {
        filterInfo.push('"' + query + '"');
    }
    if (highlightDependencies && selectedFile) {
        filterInfo.push('Dependencies of ' + selectedFile);
    }
    const filterPrefix = filterInfo.length ? '[' + filterInfo.join(' · ') + '] ' : '';
    setGraphStatus(filterPrefix + 'Showing ' + visibleCount + ' of ' + graphData.nodes.length + ' files.');
};
const renderArchitecture = () => {
    if (!graphData.nodes.length) {
        graph.setAttribute('viewBox', '0 0 800 220');
        graph.innerHTML = '<text x="400" y="110" text-anchor="middle" fill="var(--vscode-descriptionForeground)">No resolved local code connections found.</text>';
        return;
    }
    const nodeById = new Map(graphData.nodes.map(node => [node.id, node]));
    const positions = new Map();
    let width = 820;
    let height = 300;
    let columnHeaderSvg = '';

    if (currentLayout === 'by-type') {
        const catDefs = [
            { key: 'page', title: 'PAGES & ENTRY', color: colors.page },
            { key: 'component', title: 'COMPONENTS', color: colors.component },
            { key: 'utility', title: 'SERVICES & UTILS', color: colors.utility },
            { key: 'module', title: 'MODULES', color: colors.module }
        ];
        const colWidth = 220;
        const colGap = 40;
        const totalCols = catDefs.length;
        width = Math.max(920, totalCols * (colWidth + colGap) + 40);
        let maxCount = 1;

        catDefs.forEach((cat, colIdx) => {
            const nodesInCat = graphData.nodes.filter(n => n.category === cat.key).sort((a,b) => a.label.localeCompare(b.label));
            maxCount = Math.max(maxCount, nodesInCat.length);
            const colCenterX = 50 + colIdx * (colWidth + colGap) + colWidth / 2;
            columnHeaderSvg += '<g class="col-header"><rect x="' + (colCenterX - 95) + '" y="14" width="190" height="26" rx="13" fill="' + cat.color + '18" stroke="' + cat.color + '55"></rect><text x="' + colCenterX + '" y="31" text-anchor="middle" fill="' + cat.color + '" font-size="11" font-weight="700" letter-spacing="0.5">' + escapeXml(cat.title) + ' (' + nodesInCat.length + ')</text></g>';
            nodesInCat.forEach((node, rowIdx) => {
                positions.set(node.id, { x: colCenterX, y: 88 + rowIdx * 74 });
            });
        });
        height = Math.max(360, 88 + maxCount * 74 + 30);
    } else {
        const incoming = new Map(graphData.nodes.map(node => [node.id, 0]));
        const outgoing = new Map(graphData.nodes.map(node => [node.id, []]));
        graphData.edges.forEach(edge => {
            if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) { return; }
            incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
            outgoing.get(edge.from).push(edge.to);
        });
        const levels = new Map();
        const queue = graphData.nodes.filter(node => (incoming.get(node.id) || 0) === 0).map(node => node.id);
        queue.forEach(id => levels.set(id, 0));
        while (queue.length) {
            const id = queue.shift();
            const level = levels.get(id) || 0;
            (outgoing.get(id) || []).forEach(next => {
                incoming.set(next, (incoming.get(next) || 0) - 1);
                levels.set(next, Math.max(levels.get(next) || 0, level + 1));
                if ((incoming.get(next) || 0) === 0) { queue.push(next); }
            });
        }
        graphData.nodes.forEach(node => { if (!levels.has(node.id)) { levels.set(node.id, 0); } });
        const layers = new Map();
        graphData.nodes.forEach(node => {
            const level = levels.get(node.id) || 0;
            const layer = layers.get(level) || [];
            layer.push(node);
            layers.set(level, layer);
        });
        const widest = Math.max(1, ...[...layers.values()].map(layer => layer.length));
        width = Math.max(820, widest * 220 + 80);
        height = Math.max(300, layers.size * 145 + 70);
        [...layers.entries()].sort((a,b) => a[0] - b[0]).forEach(([level, layer]) => {
            layer.sort((a,b) => a.label.localeCompare(b.label));
            const spacing = width / (layer.length + 1);
            layer.forEach((node,index) => positions.set(node.id, { x: spacing * (index + 1), y: 46 + level * 145 }));
        });
    }

    const markers = Object.entries(colors).map(([kind,color]) => '<marker id="arrow-' + kind + '" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="' + color + '"></path></marker>').join('');
    const edges = graphData.edges.map((edge,index) => {
        const from = positions.get(edge.from), to = positions.get(edge.to), target = nodeById.get(edge.to);
        if (!from || !to || !target) { return ''; }

        let startX, startY, endX, endY, c1x, c1y, c2x, c2y;
        const dx = to.x - from.x;
        const dy = to.y - from.y;

        if (currentLayout === 'by-type') {
            if (Math.abs(dx) > 100) {
                // Cross-column connection: route horizontally side-to-side
                if (dx > 0) {
                    // Left column to right column
                    startX = from.x + 88;
                    startY = from.y;
                    endX = to.x - 88;
                    endY = to.y;
                    const ctrlX = Math.min(Math.abs(dx) * 0.45, 140);
                    c1x = startX + ctrlX;
                    c1y = startY;
                    c2x = endX - ctrlX;
                    c2y = endY;
                } else {
                    // Right column to left column (backward flow)
                    startX = from.x - 88;
                    startY = from.y;
                    endX = to.x + 88;
                    endY = to.y;
                    const ctrlX = Math.min(Math.abs(dx) * 0.45, 140);
                    c1x = startX - ctrlX;
                    c1y = startY;
                    c2x = endX + ctrlX;
                    c2y = endY;
                }
            } else {
                // Same column connection
                if (dy >= 0) {
                    // Top to bottom
                    startX = from.x;
                    startY = from.y + 25;
                    endX = to.x;
                    endY = to.y - 25;
                    const ctrlY = Math.max(16, dy / 2);
                    c1x = startX;
                    c1y = startY + ctrlY;
                    c2x = endX;
                    c2y = endY - ctrlY;
                } else {
                    // Bottom to top: loop around right side to avoid crossing header
                    startX = from.x + 88;
                    startY = from.y;
                    endX = to.x + 88;
                    endY = to.y;
                    const loopX = startX + 38;
                    c1x = loopX;
                    c1y = startY;
                    c2x = loopX;
                    c2y = endY;
                }
            }
        } else {
            // Hierarchical layout
            if (dy >= 0) {
                startX = from.x;
                startY = from.y + 25;
                endX = to.x;
                endY = to.y - 25;
                const ctrlY = Math.max(36, dy / 2);
                c1x = startX;
                c1y = startY + ctrlY;
                c2x = endX;
                c2y = endY - ctrlY;
            } else {
                // Backward in hierarchy: route around side
                if (dx >= 0) {
                    startX = from.x + 88;
                    startY = from.y;
                    endX = to.x + 88;
                    endY = to.y;
                    const loopX = Math.max(startX, endX) + 36;
                    c1x = loopX;
                    c1y = startY;
                    c2x = loopX;
                    c2y = endY;
                } else {
                    startX = from.x - 88;
                    startY = from.y;
                    endX = to.x - 88;
                    endY = to.y;
                    const loopX = Math.min(startX, endX) - 36;
                    c1x = loopX;
                    c1y = startY;
                    c2x = loopX;
                    c2y = endY;
                }
            }
        }

        const pathD = 'M ' + startX + ' ' + startY + ' C ' + c1x + ' ' + c1y + ', ' + c2x + ' ' + c2y + ', ' + endX + ' ' + endY;
        const title = edge.names.length ? 'Imports: ' + edge.names.join(', ') : 'Imports module';
        return '<path class="graph-edge" data-edge="' + index + '" style="--enter-delay:' + Math.min(index * 26, 420) + 'ms" d="' + pathD + '" stroke="' + colors[target.category] + '" fill="none" stroke-width="2" marker-end="url(#arrow-' + target.category + ')"><title>' + escapeXml(title) + '</title></path>';
    }).join('');
    const nodes = graphData.nodes.map((node,index) => {
        const point = positions.get(node.id);
        if (!point) { return ''; }
        const label = node.label.length > 24 ? node.label.slice(0, 21) + '…' : node.label;
        return '<g class="graph-node" data-file="' + escapeXml(node.id) + '" style="--enter-delay:' + Math.min(index * 34, 510) + 'ms" transform="translate(' + (point.x - 88) + ' ' + (point.y - 25) + ')" tabindex="0" role="button"><rect width="176" height="50" rx="8" fill="var(--vscode-sideBar-background)" stroke="' + colors[node.category] + '" stroke-width="2"></rect><text x="12" y="21" fill="' + colors[node.category] + '" font-size="11" font-weight="700">' + escapeXml(node.extension || 'FILE') + '</text><text x="44" y="32" fill="var(--vscode-foreground)" font-size="14">' + escapeXml(label) + '</text><title>Select ' + escapeXml(node.id) + '</title></g>';
    }).join('');

    graph.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    graph.dataset.initialViewBox = '0 0 ' + width + ' ' + height;
    graph.innerHTML = '<defs>' + markers + '</defs>' + edges + nodes + columnHeaderSvg;

    graph.querySelectorAll('.graph-node').forEach(node => {
        const select = () => selectFile(node.dataset.file);
        node.addEventListener('click', select);
        node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { select(); } });
    });
    graph.querySelectorAll('.graph-edge').forEach(edge => edge.addEventListener('click', event => {
        event.stopPropagation();
        selectEdge(Number(edge.dataset.edge));
    }));
    updateSelection();
};
const graphStatus = document.getElementById('graph-status');
const setGraphStatus = message => {
    if (graphStatus) graphStatus.textContent = message;
};
const renderGraphSafely = () => {
    try {
        renderArchitecture();
    } catch (error) {
        console.error('DevLens graph render failed', error);
        graph.innerHTML = '<text x="24" y="44" fill="var(--vscode-errorForeground)">DevLens could not render this graph. Refresh the dashboard to retry.</text>';
        setGraphStatus('Graph rendering failed. Other dashboard controls are still available.');
    }
};

const searchInput = document.getElementById('graph-search');
if (searchInput) {
    searchInput.addEventListener('input', () => {
        updateSelection();
    });
}

const zoom = factor => {
    const box = graph.viewBox.baseVal;
    const width = box.width * factor, height = box.height * factor;
    graph.setAttribute('viewBox', (box.x - (width - box.width) / 2) + ' ' + (box.y - (height - box.height) / 2) + ' ' + width + ' ' + height);
};
document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (!target) return;
    if (target.classList.contains('filter-pill')) {
        activeCategory = target.dataset.category || 'all';
        document.querySelectorAll('.filter-pill').forEach(pill =>
            pill.classList.toggle('active', pill === target)
        );
        updateSelection();
        setGraphStatus('Showing ' + target.textContent.trim() + ' files.');
    } else if (target.id === 'layout-toggle') {
        currentLayout = currentLayout === 'hierarchical' ? 'by-type' : 'hierarchical';
        target.textContent = currentLayout === 'hierarchical' ? 'Layout: Hierarchical' : 'Layout: Group by Type';
        target.classList.toggle('active', currentLayout === 'by-type');
        renderGraphSafely();
        setGraphStatus('Layout changed to ' +
            (currentLayout === 'hierarchical' ? 'hierarchical' : 'group by type') + '.');
    } else if (target.id === 'zoom-in') {
        zoom(0.82);
        setGraphStatus('Graph zoomed in.');
    } else if (target.id === 'zoom-out') {
        zoom(1.22);
        setGraphStatus('Graph zoomed out.');
    } else if (target.id === 'fit-graph') {
        graph.setAttribute('viewBox', graph.dataset.initialViewBox);
        setGraphStatus('Graph fitted to the available space.');
    } else if (target.id === 'highlight-deps') {
        highlightDependencies = !highlightDependencies;
        target.classList.toggle('active', highlightDependencies);
        if (highlightDependencies && !selectedFile && graphData.nodes.length > 0) {
            // If no node selected, auto-select the most connected node so dependencies immediately light up
            const mostConn = graphData.nodes.slice().sort((a, b) => {
                const countA = graphData.edges.filter(e => e.from === a.id || e.to === a.id).length;
                const countB = graphData.edges.filter(e => e.from === b.id || e.to === b.id).length;
                return countB - countA;
            })[0];
            if (mostConn) {
                selectFile(mostConn.id);
                return;
            }
        }
        updateSelection();
    }
});
let panStart;
graph.addEventListener('pointerdown', event => {
    if (event.target.closest('.graph-node, .graph-edge')) { return; }
    const box = graph.viewBox.baseVal;
    panStart = { x: event.clientX, y: event.clientY, box: { x: box.x, y: box.y, width: box.width, height: box.height } };
    graph.setPointerCapture(event.pointerId);
});
graph.addEventListener('pointermove', event => {
    if (!panStart) { return; }
    const scale = panStart.box.width / graph.clientWidth;
    graph.setAttribute('viewBox', (panStart.box.x - (event.clientX - panStart.x) * scale) + ' ' + (panStart.box.y - (event.clientY - panStart.y) * scale) + ' ' + panStart.box.width + ' ' + panStart.box.height);
});
graph.addEventListener('pointerup', () => { panStart = undefined; });
graph.addEventListener('wheel', event => {
    event.preventDefault();
    zoom(event.deltaY > 0 ? 1.12 : 0.89);
}, { passive: false });
const refreshButton = document.getElementById('refresh');
if (refreshButton) {
    refreshButton.addEventListener('click', () => vscode.postMessage({command:'refresh'}));
}
const downloadReportButton = document.getElementById('download-report');
if (downloadReportButton) {
    downloadReportButton.addEventListener('click', () => vscode.postMessage({command:'downloadReport'}));
}
document.querySelectorAll('.action-card').forEach(button => button.addEventListener('click', () => vscode.postMessage({command:'runFeature', feature:button.dataset.command})));
document.querySelectorAll('.file-link').forEach(button => button.addEventListener('click', () => vscode.postMessage({command:'openFile', filePath:button.dataset.file})));
renderGraphSafely();
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
