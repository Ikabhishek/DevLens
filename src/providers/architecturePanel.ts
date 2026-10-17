
import * as vscode from 'vscode';
import * as path from 'path';
import { DependencyGraph } from '../graph/dependencyGraph';
import { ArchitectureComponent, ArchitectureModel } from '../analyzer/architectureAnalyzer';

export function showArchitecturePanel(
    graph: DependencyGraph,
    rootUri: vscode.Uri,
    architecture: ArchitectureModel
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

    panel.webview.html = getWebviewContent(graph, architecture);

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

function getWebviewContent(
    graph: DependencyGraph,
    architecture: ArchitectureModel
): string {
    const sourceExtensions = new Set([
        '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'
    ]);
    const isToolConfig = (file: string): boolean =>
        /(^|\/)(?:vite|webpack|eslint|prettier|jest|vitest|tailwind|postcss)\.config\./i.test(file);
    const nodes = [...new Set(graph.nodes)]
        .filter(file =>
            sourceExtensions.has(path.posix.extname(file).toLowerCase()) &&
            !isToolConfig(file)
        )
        .sort();
    const visibleNodes = new Set(nodes);
    const visibleEdges = graph.edges.filter(edge =>
        visibleNodes.has(edge.from) && visibleNodes.has(edge.to)
    );

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

    const relevantFilesFor = (component: ArchitectureComponent): string[] => {
        const patterns: Record<ArchitectureComponent['category'], RegExp> = {
            frontend: /(^src\/|\.(tsx|jsx)$|\/components?\/|\.component\.ts$)/i,
            backend: /(server|api|route|controller|service)/i,
            database: /(database|\bdb\b|model|schema|prisma)/i,
            'build-tool': /(vite\.config|webpack|package\.json)/i,
            'external-service': /(firebase|supabase|aws|service)/i
        };
        return nodes.filter(file => patterns[component.category].test(file)).slice(0, 8);
    };
    const componentNode = (component: ArchitectureComponent): string => {
        const relevantFiles = relevantFilesFor(component);
        const fileList = relevantFiles.length
            ? `<ul>${relevantFiles.map(file => `<li><button class="file-link" data-file="${escapeHtml(file)}">${escapeHtml(file)}</button></li>`).join('')}</ul>`
            : '<p class="muted">No matching source files were detected.</p>';
        return `<article class="architecture-node">
            <details>
                <summary class="architecture-title">${escapeHtml(component.name)}</summary>
                <p class="meta">${escapeHtml(component.evidence)}</p>
                <p class="meta">Relevant files</p>
                ${fileList}
            </details>
        </article>`;
    };
    const componentsIn = (category: ArchitectureComponent['category']): string =>
        architecture.components.filter(component => component.category === category)
            .map(componentNode).join('');
    const frontendNodes = componentsIn('frontend');
    const backendNodes = componentsIn('backend');
    const dataNodes = `${componentsIn('database')}${componentsIn('external-service')}`;
    const buildNodes = componentsIn('build-tool');
    const architectureMap = `
        <section class="architecture-map">
            <div class="architecture-column">
                <h3>Frontend</h3>
                ${frontendNodes || '<p class="muted">No frontend framework detected.</p>'}
            </div>
            <div class="connector" aria-hidden="true">→</div>
            <div class="architecture-column">
                <h3>Backend</h3>
                ${backendNodes || '<p class="muted">No backend framework detected.</p>'}
            </div>
            <div class="connector" aria-hidden="true">→</div>
            <div class="architecture-column">
                <h3>Data & services</h3>
                ${dataNodes || '<p class="muted">No database or external service detected.</p>'}
            </div>
        </section>
        ${buildNodes ? `<section class="build-tools"><h3>Build tools</h3>${buildNodes}</section>` : ''}`;
    const graphData = {
        nodes: nodes.map(file => {
            const normalized = file.toLowerCase();
            const baseName = path.posix.basename(normalized);
            const category = /(^|\/)(components?|widgets?)(\/|$)/.test(normalized)
                ? 'component'
                : /(^|\/)(pages?|views?|routes?)(\/|$)/.test(normalized) ||
                    /^(app|main|index)\.(tsx|jsx|ts|js)$/.test(baseName)
                    ? 'page'
                    : /(^|\/)(services?|utils?|helpers?|lib)(\/|$)/.test(normalized) ||
                        /api\.(tsx|jsx|ts|js)$/.test(baseName)
                        ? 'utility'
                        : /(constants?|config|types?)\.(tsx|jsx|ts|js)$/.test(baseName)
                            ? 'module'
                            : 'module';
            const extension = path.posix.extname(file).replace('.', '').toUpperCase();
            return { id: file, label: path.posix.basename(file), category, extension };
        }),
        edges: visibleEdges.map(edge => ({
            from: edge.from,
            to: edge.to,
            names: edge.importedNames
        }))
    };
    const graphDataJson = JSON.stringify(graphData)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026');

    const nodeCards = nodes.map(file => {
        const outgoing = visibleEdges.filter(
            edge => edge.from === file
        );

        const incoming = visibleEdges.filter(
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

    const edgeRows = visibleEdges.length
        ? visibleEdges.map(edge => `
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

        .architecture-map {
            display: grid;
            grid-template-columns: minmax(180px, 1fr) auto minmax(180px, 1fr) auto minmax(180px, 1fr);
            gap: 12px;
            align-items: stretch;
            margin: 16px 0 24px;
            overflow-x: auto;
        }

        .architecture-column, .build-tools {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 12px;
            min-width: 180px;
            background: var(--vscode-sideBar-background);
        }

        .architecture-column h3, .build-tools h3 { margin-top: 0; }
        .connector { align-self: center; font-size: 24px; color: var(--vscode-descriptionForeground); }
        .architecture-node { border-left: 3px solid var(--vscode-focusBorder); padding: 8px 10px; margin: 10px 0; background: var(--vscode-editor-background); }
        .architecture-title { font-weight: 700; font-size: 15px; cursor: pointer; }
        .architecture-node ul { padding-left: 18px; }
        .build-tools { margin: 0 0 24px; }

        .graph-shell {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 10px;
            overflow: hidden;
            background: radial-gradient(circle at top, color-mix(in srgb, var(--vscode-focusBorder) 12%, var(--vscode-editor-background)), var(--vscode-editor-background) 60%);
            margin: 12px 0 24px;
        }

        .graph-toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            padding: 10px 14px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .graph-toolbar p { margin: 0; }
        .graph-toolbar button { padding: 4px 8px; }
        #code-graph { width: 100%; height: 480px; display: block; cursor: grab; }
        #code-graph:active { cursor: grabbing; }
        .legend { display: flex; flex-wrap: wrap; gap: 12px; padding: 10px 14px; border-top: 1px solid var(--vscode-panel-border); font-size: 12px; }
        .legend-item { display: flex; align-items: center; gap: 6px; }
        .legend-dot { width: 11px; height: 11px; border-radius: 3px; }

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
    <p>Explore detected components, their relevant files, and local import relationships.</p>

    <h2>Code architecture</h2>
    <section class="graph-shell">
        <div class="graph-toolbar">
            <p class="muted">Arrows show local imports: importer → imported module. Click a node to open its file.</p>
            <button id="reset-graph" type="button">Reset view</button>
        </div>
        <svg id="code-graph" role="img" aria-label="Project code architecture graph"></svg>
        <div class="legend">
            <span class="legend-item"><span class="legend-dot" style="background:#2dd4bf"></span>Component</span>
            <span class="legend-item"><span class="legend-dot" style="background:#38bdf8"></span>Page / entry</span>
            <span class="legend-item"><span class="legend-dot" style="background:#fb923c"></span>Service / utility</span>
            <span class="legend-item"><span class="legend-dot" style="background:#a78bfa"></span>Module / config</span>
        </div>
    </section>

    <h2>Architecture map</h2>
    ${architectureMap}

    <section class="stats">
        <div class="stat">
            <strong>${nodes.length}</strong>
            Code files
        </div>
        <div class="stat">
            <strong>${visibleEdges.length}</strong>
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

        const graphData = ${graphDataJson};
        const svg = document.getElementById('code-graph');
        const palette = {
            component: '#2dd4bf',
            page: '#38bdf8',
            utility: '#fb923c',
            module: '#a78bfa'
        };
        const escapeXml = value => value.replace(/[&<>"']/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[char]);
        const layoutGraph = () => {
            const nodeById = new Map(graphData.nodes.map(node => [node.id, node]));
            const incoming = new Map(graphData.nodes.map(node => [node.id, 0]));
            const outgoing = new Map(graphData.nodes.map(node => [node.id, []]));
            graphData.edges.forEach(edge => {
                if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) return;
                incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
                outgoing.get(edge.from).push(edge.to);
            });
            const levelById = new Map();
            const queue = graphData.nodes.filter(node => (incoming.get(node.id) || 0) === 0).map(node => node.id);
            queue.forEach(id => levelById.set(id, 0));
            while (queue.length) {
                const id = queue.shift();
                const level = levelById.get(id) || 0;
                (outgoing.get(id) || []).forEach(next => {
                    incoming.set(next, (incoming.get(next) || 0) - 1);
                    levelById.set(next, Math.max(levelById.get(next) || 0, level + 1));
                    if ((incoming.get(next) || 0) === 0) queue.push(next);
                });
            }
            graphData.nodes.forEach(node => {
                if (!levelById.has(node.id)) levelById.set(node.id, 0);
            });
            const layers = new Map();
            graphData.nodes.forEach(node => {
                const level = levelById.get(node.id) || 0;
                const layer = layers.get(level) || [];
                layer.push(node);
                layers.set(level, layer);
            });
            const maxPerLayer = Math.max(1, ...[...layers.values()].map(layer => layer.length));
            const width = Math.max(820, maxPerLayer * 220 + 80);
            const height = Math.max(390, layers.size * 155 + 80);
            const positions = new Map();
            [...layers.entries()].sort((a, b) => a[0] - b[0]).forEach(([level, layer]) => {
                layer.sort((a, b) => a.label.localeCompare(b.label));
                const spacing = width / (layer.length + 1);
                layer.forEach((node, index) => positions.set(node.id, {
                    x: spacing * (index + 1), y: 50 + level * 155
                }));
            });
            return { width, height, positions };
        };
        const renderGraph = () => {
            const { width, height, positions } = layoutGraph();
            svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
            svg.dataset.initialViewBox = '0 0 ' + width + ' ' + height;
            const lines = graphData.edges.map((edge, index) => {
                const from = positions.get(edge.from);
                const to = positions.get(edge.to);
                const target = graphData.nodes.find(node => node.id === edge.to);
                if (!from || !to || !target) return '';
                const curveY = Math.max(45, (to.y - from.y) / 2);
                const title = edge.names.length ? 'Imports: ' + edge.names.join(', ') : 'Imports module';
                return '<path class="graph-edge" d="M ' + from.x + ' ' + (from.y + 26) + ' C ' + from.x + ' ' + (from.y + curveY) + ', ' + to.x + ' ' + (to.y - curveY) + ', ' + to.x + ' ' + (to.y - 26) + '" stroke="' + palette[target.category] + '" fill="none" marker-end="url(#arrow-' + target.category + ')"><title>' + escapeXml(title) + '</title></path>';
            }).join('');
            const nodeMarkup = graphData.nodes.map(node => {
                const point = positions.get(node.id);
                const label = node.label.length > 25 ? node.label.slice(0, 22) + '…' : node.label;
                return '<g class="graph-node" data-file="' + escapeXml(node.id) + '" transform="translate(' + (point.x - 90) + ' ' + (point.y - 26) + ')" tabindex="0" role="button"><title>Open ' + escapeXml(node.id) + '</title><rect width="180" height="52" rx="9" fill="var(--vscode-editor-background)" stroke="' + palette[node.category] + '" stroke-width="2"></rect><text x="14" y="31" fill="' + palette[node.category] + '" font-weight="700" font-size="12">' + escapeXml(node.extension || 'FILE') + '</text><text x="48" y="31" fill="var(--vscode-foreground)" font-size="14">' + escapeXml(label) + '</text></g>';
            }).join('');
            const markers = Object.entries(palette).map(([category, color]) =>
                '<marker id="arrow-' + category + '" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="' + color + '"></path></marker>'
            ).join('');
            svg.innerHTML = '<defs>' + markers + '</defs><g class="graph-edges">' + lines + '</g><g>' + nodeMarkup + '</g>';
            svg.querySelectorAll('.graph-node').forEach(node => {
                const open = () => vscode.postMessage({ command: 'openFile', filePath: node.dataset.file });
                node.addEventListener('click', open);
                node.addEventListener('keydown', event => {
                    if (event.key === 'Enter' || event.key === ' ') open();
                });
            });
        };
        renderGraph();
        let panStart;
        svg.addEventListener('pointerdown', event => {
            const box = svg.viewBox.baseVal;
            panStart = {
                x: event.clientX,
                y: event.clientY,
                box: { x: box.x, y: box.y, width: box.width, height: box.height }
            };
            svg.setPointerCapture(event.pointerId);
        });
        svg.addEventListener('pointermove', event => {
            if (!panStart) return;
            const box = panStart.box;
            const scale = box.width / svg.clientWidth;
            svg.setAttribute('viewBox', (box.x - (event.clientX - panStart.x) * scale) + ' ' + (box.y - (event.clientY - panStart.y) * scale) + ' ' + box.width + ' ' + box.height);
        });
        svg.addEventListener('pointerup', () => { panStart = undefined; });
        svg.addEventListener('wheel', event => {
            event.preventDefault();
            const box = svg.viewBox.baseVal;
            const factor = event.deltaY > 0 ? 1.12 : 0.89;
            const width = Math.max(240, box.width * factor);
            const height = Math.max(160, box.height * factor);
            svg.setAttribute('viewBox', (box.x - (width - box.width) / 2) + ' ' + (box.y - (height - box.height) / 2) + ' ' + width + ' ' + height);
        }, { passive: false });
        document.getElementById('reset-graph').addEventListener('click', () => svg.setAttribute('viewBox', svg.dataset.initialViewBox));

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
