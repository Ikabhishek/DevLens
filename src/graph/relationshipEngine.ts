import { AstAnalysis, CodeSymbolInfo } from '../analyzer/astAnalyzer';
import { DependencyGraph } from './dependencyGraph';

export interface RelationshipSymbol extends CodeSymbolInfo {
    id: string;
    filePath: string;
}

export interface CallRelationship {
    callerFile: string;
    callerSymbol?: string;
    expression: string;
    line: number;
    targetId?: string;
}

export interface SymbolRelationships {
    symbol: RelationshipSymbol;
    callers: CallRelationship[];
    localDependencies: RelationshipSymbol[];
    importedBy: string[];
    importsFrom: string[];
}

export interface RelationshipGraph {
    symbols: RelationshipSymbol[];
    calls: CallRelationship[];
    dependencyGraph: DependencyGraph;
}

function symbolId(filePath: string, symbol: CodeSymbolInfo): string {
    return `${filePath}:${symbol.line}:${symbol.kind}:${symbol.name}`;
}

function callRoot(expression: string): string | undefined {
    const match = expression.match(/^([A-Za-z_$][\w$]*)/);
    return match?.[1];
}

function callMember(expression: string): string | undefined {
    const match = expression.match(/^[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)/);
    return match?.[1];
}

export function buildRelationshipGraph(
    ast: AstAnalysis,
    dependencyGraph: DependencyGraph
): RelationshipGraph {
    const symbols = ast.modules.flatMap(module =>
        module.symbols.map(symbol => ({
            ...symbol,
            id: symbolId(module.filePath, symbol),
            filePath: module.filePath
        }))
    );
    const symbolsByFile = new Map<string, RelationshipSymbol[]>();
    for (const symbol of symbols) {
        const values = symbolsByFile.get(symbol.filePath) ?? [];
        values.push(symbol);
        symbolsByFile.set(symbol.filePath, values);
    }

    const calls: CallRelationship[] = [];
    for (const module of ast.modules) {
        const outgoingEdges = dependencyGraph.edges.filter(edge => edge.from === module.filePath);
        for (const call of module.calls) {
            const root = callRoot(call.name);
            if (!root) continue;
            const member = callMember(call.name);

            const localTarget = (symbolsByFile.get(module.filePath) ?? []).find(symbol =>
                symbol.name === root && (symbol.kind === 'function' || symbol.kind === 'method')
            );
            const importedCandidates = outgoingEdges
                .filter(edge => edge.importedNames.includes(root) || edge.importedNames.includes('*'))
                .flatMap(edge => symbolsByFile.get(edge.to) ?? []);
            const importedTarget = member
                ? importedCandidates.find(symbol => symbol.name === member)
                : importedCandidates.find(symbol => symbol.name === root || symbol.isExported);

            calls.push({
                callerFile: module.filePath,
                callerSymbol: call.containingSymbol,
                expression: call.name,
                line: call.line,
                targetId: localTarget?.id ?? importedTarget?.id
            });
        }
    }

    return { symbols, calls, dependencyGraph };
}

export function getSymbolRelationships(
    graph: RelationshipGraph,
    symbolIdToFind: string
): SymbolRelationships | undefined {
    const symbol = graph.symbols.find(candidate => candidate.id === symbolIdToFind);
    if (!symbol) return undefined;

    const importedBy = graph.dependencyGraph.edges
        .filter(edge => edge.to === symbol.filePath)
        .map(edge => edge.from);
    const importsFrom = graph.dependencyGraph.edges
        .filter(edge => edge.from === symbol.filePath)
        .map(edge => edge.to);
    const calledTargetIds = graph.calls
        .filter(call =>
            call.callerFile === symbol.filePath &&
            call.callerSymbol === symbol.name &&
            call.targetId !== undefined
        )
        .map(call => call.targetId);
    const localDependencies = graph.symbols.filter(candidate =>
        calledTargetIds.includes(candidate.id)
    );

    return {
        symbol,
        callers: graph.calls.filter(call => call.targetId === symbol.id),
        localDependencies,
        importedBy,
        importsFrom
    };
}
