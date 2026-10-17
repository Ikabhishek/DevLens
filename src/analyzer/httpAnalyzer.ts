import * as path from 'path';
import * as ts from 'typescript';
import * as vscode from 'vscode';

export interface HttpRequest {
    filePath: string;
    line: number;
    method: string;
    path: string;
    containingSymbol?: string;
}

export interface ApiRoute {
    filePath: string;
    line: number;
    method: string;
    path: string;
    handlerName?: string;
    handlerFilePath?: string;
}

export interface HttpAnalysis {
    requests: HttpRequest[];
    routes: ApiRoute[];
}

type ImportBinding = { source?: string; importedName: string };
type RouterMount = { prefix: string; targetFile: string };

const SOURCE_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'
]);
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

function scriptKind(extension: string): ts.ScriptKind {
    if (extension === '.tsx') return ts.ScriptKind.TSX;
    if (extension === '.jsx') return ts.ScriptKind.JSX;
    return ['.js', '.mjs', '.cjs'].includes(extension) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

function staticString(node: ts.Expression | undefined): string | undefined {
    if (!node) return undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    return undefined;
}

function normalizePath(value: string): string {
    const prefixed = value.startsWith('/') ? value : `/${value}`;
    return prefixed.length > 1 ? prefixed.replace(/\/+$/, '') : prefixed;
}

function joinRoute(prefix: string, route: string): string {
    return normalizePath(`${prefix.replace(/\/$/, '')}/${route.replace(/^\//, '')}`);
}

function resolveLocalImport(
    source: string,
    importer: string,
    knownFiles: Set<string>
): string | undefined {
    if (!source.startsWith('.')) return undefined;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), source));
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
    return [base, ...extensions.map(extension => base + extension), ...extensions.map(extension => path.posix.join(base, `index${extension}`))]
        .find(candidate => knownFiles.has(candidate));
}

function functionName(node: ts.Node): string | undefined {
    if (ts.isFunctionDeclaration(node)) return node.name?.text;
    if (ts.isMethodDeclaration(node)) return node.name.getText();
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        return node.name.text;
    }
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        return node.name.text;
    }
    return undefined;
}

function fetchMethod(call: ts.CallExpression): string {
    const options = call.arguments[1];
    if (options && ts.isObjectLiteralExpression(options)) {
        const methodProperty = options.properties.find(property =>
            ts.isPropertyAssignment(property) && property.name.getText() === 'method'
        );
        if (methodProperty && ts.isPropertyAssignment(methodProperty)) {
            return staticString(methodProperty.initializer)?.toUpperCase() ?? 'GET';
        }
    }
    return 'GET';
}

export async function analyzeHttp(
    root: vscode.Uri,
    relativePaths: string[]
): Promise<HttpAnalysis> {
    const files = relativePaths.map(file => file.replace(/\\/g, '/'));
    const knownFiles = new Set(files);
    const requests: HttpRequest[] = [];
    const routes: ApiRoute[] = [];
    const mounts: RouterMount[] = [];

    for (const filePath of files) {
        const extension = path.posix.extname(filePath).toLowerCase();
        if (!SOURCE_EXTENSIONS.has(extension)) continue;
        let sourceText: string;
        try {
            sourceText = Buffer.from(await vscode.workspace.fs.readFile(
                vscode.Uri.joinPath(root, ...filePath.split('/'))
            )).toString('utf8');
        } catch {
            continue;
        }

        const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind(extension));
        const imports = new Map<string, ImportBinding>();
        const lineOf = (node: ts.Node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

        const handlerReference = (node: ts.Expression | undefined): { name?: string; filePath?: string } => {
            if (!node) return {};
            if (ts.isIdentifier(node)) {
                const imported = imports.get(node.text);
                return { name: imported?.importedName ?? node.text, filePath: imported?.source ?? filePath };
            }
            if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
                const imported = imports.get(node.expression.text);
                return { name: node.name.text, filePath: imported?.source };
            }
            return {};
        };

        function visit(node: ts.Node, containingSymbol?: string): void {
            const declaredName = functionName(node);
            const childSymbol = declaredName ?? containingSymbol;

            if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
                const source = resolveLocalImport(node.moduleSpecifier.text, filePath, knownFiles);
                const clause = node.importClause;
                if (clause?.name) imports.set(clause.name.text, { source, importedName: 'default' });
                if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
                    imports.set(clause.namedBindings.name.text, { source, importedName: '*' });
                } else if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
                    clause.namedBindings.elements.forEach(element => imports.set(element.name.text, {
                        source,
                        importedName: element.propertyName?.text ?? element.name.text
                    }));
                }
            }

            if (ts.isCallExpression(node)) {
                const expression = node.expression;
                const firstArgument = staticString(node.arguments[0]);
                const isFetch = ts.isIdentifier(expression) && expression.text === 'fetch';
                const isProperty = ts.isPropertyAccessExpression(expression);
                const method = isProperty ? expression.name.text.toLowerCase() : undefined;
                const clientName = isProperty ? expression.expression.getText(sourceFile) : '';
                const isHttpClient = !!method && HTTP_METHODS.has(method) &&
                    /(?:axios|client|http|request|api)/i.test(clientName);

                if (firstArgument && (isFetch || isHttpClient)) {
                    requests.push({
                        filePath,
                        line: lineOf(node),
                        method: isFetch ? fetchMethod(node) : method!.toUpperCase(),
                        path: normalizePath(firstArgument),
                        containingSymbol
                    });
                }

                const routeObject = isProperty ? expression.expression.getText(sourceFile) : '';
                const isRouter = !!method && HTTP_METHODS.has(method) && /(?:app|router|server)$/i.test(routeObject);
                if (firstArgument && isRouter) {
                    const handler = handlerReference(node.arguments[1]);
                    routes.push({
                        filePath,
                        line: lineOf(node),
                        method: method!.toUpperCase(),
                        path: normalizePath(firstArgument),
                        handlerName: handler.name,
                        handlerFilePath: handler.filePath
                    });
                }

                const isUse = isProperty && expression.name.text === 'use' && /(?:app|router|server)$/i.test(routeObject);
                if (isUse && firstArgument && node.arguments[1] && ts.isIdentifier(node.arguments[1])) {
                    const imported = imports.get(node.arguments[1].text);
                    if (imported?.source) mounts.push({ prefix: normalizePath(firstArgument), targetFile: imported.source });
                }
            }
            ts.forEachChild(node, child => visit(child, childSymbol));
        }
        visit(sourceFile);
    }

    const mountedRoutes = mounts.flatMap(mount => routes
        .filter(route => route.filePath === mount.targetFile)
        .map(route => ({ ...route, path: joinRoute(mount.prefix, route.path) }))
    );
    const allRoutes = [...routes, ...mountedRoutes];
    const uniqueRoutes = allRoutes.filter((route, index, values) =>
        values.findIndex(candidate =>
            candidate.filePath === route.filePath && candidate.line === route.line && candidate.path === route.path
        ) === index
    );
    return { requests, routes: uniqueRoutes };
}
