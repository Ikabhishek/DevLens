import { HttpAnalysis } from '../analyzer/httpAnalyzer';
import { RelationshipGraph, RelationshipSymbol } from './relationshipEngine';

export interface FlowNode {
    id: string;
    label: string;
    filePath: string;
    line: number;
    kind: RelationshipSymbol['kind'] | 'request' | 'route';
    depth: number;
}

export interface FlowEdge {
    from: string;
    to: string;
    expression: string;
    line: number;
}

export interface FlowTrace {
    start: FlowNode;
    nodes: FlowNode[];
    edges: FlowEdge[];
}

function findCallerSymbolId(
    graph: RelationshipGraph,
    filePath: string,
    name: string | undefined
): string | undefined {
    if (!name) return undefined;
    const matches = graph.symbols.filter(symbol =>
        symbol.filePath === filePath && symbol.name === name
    );
    return matches.find(symbol =>
        symbol.kind === 'function' || symbol.kind === 'method' || symbol.kind === 'class'
    )?.id ?? matches[0]?.id;
}

export function traceFlow(
    graph: RelationshipGraph,
    startId: string,
    http: HttpAnalysis,
    maxDepth = 8
): FlowTrace | undefined {
    const startSymbol = graph.symbols.find(symbol => symbol.id === startId);
    if (!startSymbol) return undefined;

    const callsByCaller = new Map<string, typeof graph.calls>();
    for (const call of graph.calls) {
        if (!call.targetId) continue;
        const callerId = findCallerSymbolId(graph, call.callerFile, call.callerSymbol);
        if (!callerId) continue;
        const calls = callsByCaller.get(callerId) ?? [];
        calls.push(call);
        callsByCaller.set(callerId, calls);
    }

    const symbolsById = new Map(graph.symbols.map(symbol => [symbol.id, symbol]));
    const depthById = new Map<string, number>();
    const nodesById = new Map<string, FlowNode>();
    const queue: string[] = [];
    const edges: FlowEdge[] = [];
    const edgeKeys = new Set<string>();

    const addSymbol = (symbolId: string, depth: number): void => {
        const symbol = symbolsById.get(symbolId);
        if (!symbol || depthById.has(symbolId)) return;
        depthById.set(symbolId, depth);
        nodesById.set(symbolId, {
            id: symbol.id,
            label: symbol.name,
            filePath: symbol.filePath,
            line: symbol.line,
            kind: symbol.kind,
            depth
        });
        queue.push(symbolId);
    };
    const addNode = (node: FlowNode): void => {
        if (nodesById.has(node.id)) return;
        nodesById.set(node.id, node);
        depthById.set(node.id, node.depth);
    };
    const addEdge = (from: string, to: string, expression: string, line: number): void => {
        const key = `${from}:${to}:${line}:${expression}`;
        if (edgeKeys.has(key)) return;
        edgeKeys.add(key);
        edges.push({ from, to, expression, line });
    };
    const handlerSymbol = (filePath: string | undefined, name: string | undefined): RelationshipSymbol | undefined =>
        graph.symbols.find(symbol => symbol.filePath === filePath && symbol.name === name);

    addSymbol(startId, 0);
    while (queue.length) {
        const from = queue.shift();
        if (!from) continue;
        const source = nodesById.get(from);
        if (!source || source.depth >= maxDepth) continue;

        for (const call of callsByCaller.get(from) ?? []) {
            if (!call.targetId) continue;
            addSymbol(call.targetId, source.depth + 1);
            addEdge(from, call.targetId, call.expression, call.line);
        }

        const sourceSymbol = symbolsById.get(from);
        if (!sourceSymbol) continue;
        const requests = http.requests.filter(request =>
            request.filePath === sourceSymbol.filePath &&
            request.containingSymbol === sourceSymbol.name
        );
        for (const request of requests) {
            const requestId = `request:${request.filePath}:${request.line}`;
            addNode({
                id: requestId,
                label: `${request.method} ${request.path}`,
                filePath: request.filePath,
                line: request.line,
                kind: 'request',
                depth: source.depth + 1
            });
            addEdge(from, requestId, `${request.method} ${request.path}`, request.line);

            const matchingRoutes = http.routes.filter(route =>
                route.method === request.method && route.path === request.path
            );
            for (const route of matchingRoutes) {
                const routeId = `route:${route.filePath}:${route.line}:${route.path}`;
                addNode({
                    id: routeId,
                    label: `${route.method} ${route.path}`,
                    filePath: route.filePath,
                    line: route.line,
                    kind: 'route',
                    depth: source.depth + 2
                });
                addEdge(requestId, routeId, 'matches route', route.line);
                const handler = handlerSymbol(route.handlerFilePath, route.handlerName);
                if (handler) {
                    addSymbol(handler.id, source.depth + 3);
                    addEdge(routeId, handler.id, route.handlerName ?? 'route handler', route.line);
                }
            }
        }
    }

    const start = nodesById.get(startId);
    if (!start) return undefined;
    return {
        start,
        nodes: [...nodesById.values()].sort((a, b) => a.depth - b.depth || a.label.localeCompare(b.label)),
        edges
    };
}
