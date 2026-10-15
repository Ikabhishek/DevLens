import * as vscode from 'vscode';
import { ArchitectureCategory, ArchitectureModel } from '../analyzer/architectureAnalyzer';

const CATEGORY_LABELS: Record<ArchitectureCategory, string> = {
    frontend: 'Frontend',
    backend: 'Backend',
    database: 'Database',
    'build-tool': 'Build tools',
    'external-service': 'External services'
};

export function showArchitectureDetectionPanel(model: ArchitectureModel): void {
    const panel = vscode.window.createWebviewPanel(
        'devlensArchitectureDetection',
        'DevLens Architecture Detection',
        vscode.ViewColumn.One,
        { enableScripts: false }
    );
    panel.webview.html = getWebviewContent(model);
}

function getWebviewContent(model: ArchitectureModel): string {
    const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char] ?? char);
    const groups = (Object.keys(CATEGORY_LABELS) as ArchitectureCategory[]).map(category => ({
        label: CATEGORY_LABELS[category],
        components: model.components.filter(component => component.category === category)
    })).filter(group => group.components.length);
    const groupHtml = groups.length
        ? groups.map(group => `<section class="card"><h2>${group.label}</h2><ul>${group.components.map(component =>
            `<li><strong>${escapeHtml(component.name)}</strong><span>${escapeHtml(component.evidence)}</span></li>`
        ).join('')}</ul></section>`).join('')
        : '<p class="muted">No supported architecture components were detected.</p>';

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
body { padding: 20px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
.card { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 14px; margin: 12px 0; } h1 { margin-bottom: 4px; } h2 { font-size: 16px; margin: 0; } .muted, span { color: var(--vscode-descriptionForeground); } li { margin: 10px 0; } li span { display: block; margin-top: 3px; font-size: 12px; }
</style></head><body><h1>Detected architecture</h1><p class="muted">Evidence is derived from project configuration and dependencies.${model.packageManager ? ` Package manager: ${escapeHtml(model.packageManager)}.` : ''}</p>${groupHtml}</body></html>`;
}
