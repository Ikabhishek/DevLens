import { ImportExportAnalysis } from '../analyzer/importExportAnalyzer';

export interface DependencyEdge {
    from: string;
    to: string;
    importedNames: string[];
}

export interface DependencyGraph {
    nodes: string[];
    edges: DependencyEdge[];
}

export function buildDependencyGraph(
    analysis: ImportExportAnalysis
): DependencyGraph {
    const nodes = analysis.modules.map(
        module => module.filePath
    );

    const edges: DependencyEdge[] = [];

    for (const module of analysis.modules) {
        for (const item of module.imports) {
            if (!item.resolvedPath) {
                continue;
            }

            edges.push({
                from: module.filePath,
                to: analysis.modules.find(candidate =>
                    candidate.filePath ===
                    item.resolvedPath
                )?.filePath ?? item.resolvedPath,
                importedNames: item.importedNames
            });
        }
    }

    return { nodes, edges };
}
