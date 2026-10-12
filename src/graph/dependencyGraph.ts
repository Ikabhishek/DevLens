
import { ImportExportAnalysis } from '../analyzer/importExportAnalyzer';
import * as path from 'path';

export interface DependencyEdge {
    from: string;
    to: string;
    importedNames: string[];
}

export interface DependencyGraph {
    nodes: string[];
    edges: DependencyEdge[];
}

function normalizeRelativePath(filePath: string): string {
    return path.posix.normalize(filePath.replace(/\\/g, '/'));
}

export function buildDependencyGraph(
    analysis: ImportExportAnalysis,
    projectFiles: string[] = analysis.modules.map(
        module => module.filePath
    )
): DependencyGraph {
    const nodes = [...new Set(
        projectFiles.map(normalizeRelativePath)
    )].sort();

    const knownFiles = new Set(nodes);
    const edges: DependencyEdge[] = [];

    for (const module of analysis.modules) {
        const from = normalizeRelativePath(module.filePath);

        for (const item of module.imports) {
            if (!item.resolvedPath) {
                continue;
            }

            const to = normalizeRelativePath(item.resolvedPath);

            if (!knownFiles.has(from) || !knownFiles.has(to)) {
                continue;
            }

            edges.push({
                from,
                to,
                importedNames: item.importedNames
            });
        }
    }

    return { nodes, edges };
}
