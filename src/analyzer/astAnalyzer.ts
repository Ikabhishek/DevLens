import * as path from 'path';
import * as ts from 'typescript';
import * as vscode from 'vscode';

export type CodeSymbolKind = 'function' | 'class' | 'method' | 'variable';

export interface CodeSymbolInfo {
    name: string;
    kind: CodeSymbolKind;
    line: number;
    parameters: string[];
    returnExpression?: string;
    isExported: boolean;
}

export interface CodeCallInfo {
    name: string;
    line: number;
    containingSymbol?: string;
}

export interface AstModuleInfo {
    filePath: string;
    symbols: CodeSymbolInfo[];
    calls: CodeCallInfo[];
    imports: string[];
    exports: string[];
}

export interface AstAnalysis {
    modules: AstModuleInfo[];
    totals: {
        functions: number;
        classes: number;
        methods: number;
        variables: number;
        calls: number;
        imports: number;
        exports: number;
    };
}

const SOURCE_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'
]);

function getScriptKind(extension: string): ts.ScriptKind {
    if (extension === '.tsx') return ts.ScriptKind.TSX;
    if (extension === '.jsx') return ts.ScriptKind.JSX;
    if (['.js', '.mjs', '.cjs'].includes(extension)) return ts.ScriptKind.JS;
    return ts.ScriptKind.TS;
}

function getBindingNames(name: ts.BindingName): string[] {
    if (ts.isIdentifier(name)) return [name.text];
    return name.elements.flatMap(element =>
        ts.isOmittedExpression(element) ? [] : getBindingNames(element.name)
    );
}

function getPropertyName(name: ts.PropertyName | undefined): string | undefined {
    if (!name) return undefined;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        return name.text;
    }
    return name.getText();
}

export async function analyzeAst(
    root: vscode.Uri,
    relativePaths: string[]
): Promise<AstAnalysis> {
    const modules: AstModuleInfo[] = [];

    for (const relativePath of relativePaths) {
        const extension = path.posix.extname(relativePath).toLowerCase();
        if (!SOURCE_EXTENSIONS.has(extension)) continue;

        const uri = vscode.Uri.joinPath(root, ...relativePath.replace(/\\/g, '/').split('/'));
        let sourceText: string;
        try {
            sourceText = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        } catch {
            continue;
        }

        const sourceFile = ts.createSourceFile(
            relativePath,
            sourceText,
            ts.ScriptTarget.Latest,
            true,
            getScriptKind(extension)
        );
        const module: AstModuleInfo = {
            filePath: relativePath,
            symbols: [],
            calls: [],
            imports: [],
            exports: []
        };

        const lineOf = (node: ts.Node): number =>
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const isExported = (node: ts.Node): boolean =>
            !!ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some(modifier =>
                modifier.kind === ts.SyntaxKind.ExportKeyword ||
                modifier.kind === ts.SyntaxKind.DefaultKeyword
            );
        const addSymbol = (
            node: ts.Node,
            name: string,
            kind: CodeSymbolKind,
            parameters: readonly ts.ParameterDeclaration[] = [],
            body?: ts.ConciseBody | ts.Block,
            exported = false
        ): void => {
            let returnExpression: string | undefined;
            if (body && !ts.isBlock(body)) {
                returnExpression = body.getText(sourceFile);
            } else if (body) {
                const returned = body.statements.find(ts.isReturnStatement);
                if (returned?.expression) returnExpression = returned.expression.getText(sourceFile);
            }
            module.symbols.push({
                name,
                kind,
                line: lineOf(node),
                parameters: parameters.flatMap(parameter => getBindingNames(parameter.name)),
                returnExpression,
                isExported: exported
            });
        };

        function visit(node: ts.Node, containingSymbol?: string): void {
            if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
                module.imports.push(node.moduleSpecifier.text);
            } else if (ts.isImportEqualsDeclaration(node)) {
                module.imports.push(node.moduleReference.getText(sourceFile));
            }

            if (ts.isExportDeclaration(node)) {
                if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
                    module.exports.push(`from ${node.moduleSpecifier.text}`);
                } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
                    module.exports.push(...node.exportClause.elements.map(element => element.name.text));
                } else {
                    module.exports.push('*');
                }
            } else if (ts.isExportAssignment(node)) {
                module.exports.push('default');
            }

            let childContainingSymbol = containingSymbol;

            if (ts.isFunctionDeclaration(node)) {
                const exported = isExported(node);
                const name = node.name?.text ?? '<anonymous>';
                addSymbol(node, name, 'function', node.parameters, node.body, exported);
                if (exported) module.exports.push(name);
                childContainingSymbol = name;
            } else if (ts.isClassDeclaration(node)) {
                const exported = isExported(node);
                const name = node.name?.text ?? '<anonymous>';
                addSymbol(node, name, 'class', [], undefined, exported);
                if (exported) module.exports.push(name);
            } else if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
                const name = getPropertyName(node.name) ?? '<computed>';
                addSymbol(node, name, 'method', node.parameters, 'body' in node ? node.body : undefined, isExported(node));
                childContainingSymbol = name;
            } else if (ts.isVariableDeclaration(node)) {
                const statement = node.parent.parent;
                const exported = ts.isVariableStatement(statement) && isExported(statement);
                for (const name of getBindingNames(node.name)) {
                    addSymbol(node, name, 'variable', [], undefined, exported);
                    if (exported) module.exports.push(name);
                    if (node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
                        addSymbol(node, name, 'function', node.initializer.parameters, node.initializer.body, exported);
                        childContainingSymbol = name;
                    }
                }
            }

            if (ts.isCallExpression(node)) {
                const name = node.expression.getText(sourceFile);
                module.calls.push({ name, line: lineOf(node), containingSymbol });
            }
            ts.forEachChild(node, child => visit(child, childContainingSymbol));
        }

        visit(sourceFile);
        modules.push(module);
    }

    return {
        modules,
        totals: {
            functions: modules.reduce((sum, module) => sum + module.symbols.filter(symbol => symbol.kind === 'function').length, 0),
            classes: modules.reduce((sum, module) => sum + module.symbols.filter(symbol => symbol.kind === 'class').length, 0),
            methods: modules.reduce((sum, module) => sum + module.symbols.filter(symbol => symbol.kind === 'method').length, 0),
            variables: modules.reduce((sum, module) => sum + module.symbols.filter(symbol => symbol.kind === 'variable').length, 0),
            calls: modules.reduce((sum, module) => sum + module.calls.length, 0),
            imports: modules.reduce((sum, module) => sum + module.imports.length, 0),
            exports: modules.reduce((sum, module) => sum + module.exports.length, 0)
        }
    };
}
