import {
    CallRelationship,
    RelationshipGraph,
    RelationshipSymbol
} from './relationshipEngine';

export type ImpactLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ImpactAnalysis {
    symbol: RelationshipSymbol;
    level: ImpactLevel;
    directCallers: CallRelationship[];
    directImporters: string[];
    transitiveImporters: string[];
    affectedFiles: string[];
}

export function analyzeImpact(
    graph: RelationshipGraph,
    symbolId: string
): ImpactAnalysis | undefined {
    const symbol = graph.symbols.find(candidate => candidate.id === symbolId);
    if (!symbol) return undefined;

    const reverseDependencies = new Map<string, string[]>();
    for (const edge of graph.dependencyGraph.edges) {
        const importers = reverseDependencies.get(edge.to) ?? [];
        importers.push(edge.from);
        reverseDependencies.set(edge.to, importers);
    }

    const directImporters = [...new Set(
        reverseDependencies.get(symbol.filePath) ?? []
    )].sort();
    const visited = new Set<string>(directImporters);
    const queue = [...directImporters];
    while (queue.length) {
        const file = queue.shift();
        if (!file) continue;
        for (const importer of reverseDependencies.get(file) ?? []) {
            if (!visited.has(importer)) {
                visited.add(importer);
                queue.push(importer);
            }
        }
    }

    const transitiveImporters = [...visited]
        .filter(file => !directImporters.includes(file))
        .sort();
    const directCallers = graph.calls.filter(call => call.targetId === symbol.id);
    const affectedFiles = [...new Set([
        ...visited,
        ...directCallers.map(caller => caller.callerFile)
    ])].sort();
    const level: ImpactLevel = affectedFiles.length >= 4 || directCallers.length >= 3
        ? 'HIGH'
        : affectedFiles.length >= 2 || directCallers.length >= 1
            ? 'MEDIUM'
            : 'LOW';

    return {
        symbol,
        level,
        directCallers,
        directImporters,
        transitiveImporters,
        affectedFiles
    };
}
