import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as path from 'path';

export interface ImportInfo {
    source: string;
    resolvedPath?: string;
    importedNames: string[];
    isTypeOnly: boolean;
    isExternal: boolean;
    line: number;
}

export interface ExportInfo {
    name: string;
    kind: 'named' | 'default' | 're-export';
    isTypeOnly: boolean;
    line: number;
}

export interface FileModuleInfo {
    filePath: string;
    imports: ImportInfo[];
    exports: ExportInfo[];
}

export interface ImportExportAnalysis {
    modules: FileModuleInfo[];
    unresolvedImports: {
        filePath: string;
        source: string;
        line: number;
    }[];
}


function getModuleSpecifier(
    node: ts.Node
): string | undefined {
    if (
        (ts.isImportDeclaration(node) ||
         ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
    ) {
        return node.moduleSpecifier.text;
    }

    if (
        ts.isCallExpression(node) &&
        node.arguments.length > 0
    ) {
        const first = node.arguments[0];

        if (ts.isStringLiteral(first)) {
            if (
                node.expression.kind ===
                ts.SyntaxKind.ImportKeyword
            ) {
                return first.text;
            }

            if (
                ts.isIdentifier(node.expression) &&
                node.expression.text === 'require'
            ) {
                return first.text;
            }
        }
    }

    return undefined;
}

function getImportNames(
    node: ts.ImportDeclaration
): string[] {
    const clause = node.importClause;

    if (!clause) {
        return [];
    }

    const names: string[] = [];

    if (clause.name) {
        names.push('default');
    }

    const bindings = clause.namedBindings;

    if (bindings && ts.isNamespaceImport(bindings)) {
        names.push('*');
    } else if (
        bindings &&
        ts.isNamedImports(bindings)
    ) {
        for (const element of bindings.elements) {
            names.push(
                element.propertyName?.text ??
                element.name.text
            );
        }
    }

    return names;
}

function resolveLocalImport(
    source: string,
    importer: vscode.Uri,
    knownFiles: Set<string>
): string | undefined {
    if (!source.startsWith('.')) {
        return undefined;
    }

    const base = path.posix.normalize(
        path.posix.join(
            path.posix.dirname(importer.path),
            source
        )
    );

    const candidates = [
        base,
        ...[
            '.ts', '.tsx', '.js', '.jsx',
            '.mts', '.cts', '.mjs', '.cjs',
            '.json'
        ].map(ext => base + ext),
        ...[
            'index.ts', 'index.tsx',
            'index.js', 'index.jsx'
        ].map(index => path.posix.join(base, index))
    ];

    return candidates.find(candidate =>
        knownFiles.has(candidate)
    );
}

export async function analyzeImportsAndExports(
    root: vscode.Uri,
    relativePaths: string[]
): Promise<ImportExportAnalysis> {
    const knownFiles = new Set(
        relativePaths.map(relativePath =>
            path.posix.join(
                root.path,
                relativePath.replace(/\\/g, '/')
            )
        )
    );

    const modules: FileModuleInfo[] = [];
    const unresolvedImports: ImportExportAnalysis[
        'unresolvedImports'
    ] = [];

    for (const relativePath of relativePaths) {
        const uri = vscode.Uri.joinPath(
            root,
            ...relativePath.split(/[\\/]/)
        );

        const extension = path.posix.extname(
            relativePath
        ).toLowerCase();

        if (![
            '.ts', '.tsx', '.js', '.jsx',
            '.mts', '.cts', '.mjs', '.cjs'
        ].includes(extension)) {
            continue;
        }

        let content: Uint8Array;

        try {
            content = await vscode.workspace.fs.readFile(uri);
        } catch {
            continue;
        }

        const sourceText = Buffer.from(content).toString('utf8');

        const sourceFile = ts.createSourceFile(
            relativePath,
            sourceText,
            ts.ScriptTarget.Latest,
            true,
            extension.endsWith('x')
                ? ts.ScriptKind.TSX
                : extension.endsWith('js') ||
                  extension.endsWith('jsx') ||
                  extension.endsWith('mjs') ||
                  extension.endsWith('cjs')
                    ? ts.ScriptKind.JS
                    : ts.ScriptKind.TS
        );

        const moduleInfo: FileModuleInfo = {
            filePath: relativePath,
            imports: [],
            exports: []
        };

        function visit(node: ts.Node): void {
            const line =
                sourceFile.getLineAndCharacterOfPosition(
                    node.getStart(sourceFile)
                ).line + 1;

            if (ts.isImportDeclaration(node)) {
                const source = node.moduleSpecifier.text;
                const resolvedPath = resolveLocalImport(
                    source,
                    uri,
                    knownFiles
                );

                moduleInfo.imports.push({
                    source,
                    resolvedPath,
                    importedNames: getImportNames(node),
                    isTypeOnly:
                        node.importClause?.isTypeOnly ?? false,
                    isExternal: !source.startsWith('.'),
                    line
                });

                if (
                    source.startsWith('.') &&
                    !resolvedPath
                ) {
                    unresolvedImports.push({
                        filePath: relativePath,
                        source,
                        line
                    });
                }
            }

            if (ts.isExportDeclaration(node)) {
                const source = node.moduleSpecifier &&
                    ts.isStringLiteral(node.moduleSpecifier)
                    ? node.moduleSpecifier.text
                    : undefined;

                if (source) {
                    moduleInfo.exports.push({
                        name: source,
                        kind: 're-export',
                        isTypeOnly: node.isTypeOnly,
                        line
                    });
                } else if (node.exportClause &&
                           ts.isNamedExports(node.exportClause)) {
                    for (
                        const element of node.exportClause.elements
                    ) {
                        moduleInfo.exports.push({
                            name: element.name.text,
                            kind: 'named',
                            isTypeOnly:
                                node.isTypeOnly ||
                                element.isTypeOnly,
                            line
                        });
                    }
                } else if (!node.exportClause) {
                    moduleInfo.exports.push({
                        name: '*',
                        kind: 're-export',
                        isTypeOnly: node.isTypeOnly,
                        line
                    });
                }
            }

            if (ts.isExportAssignment(node)) {
                moduleInfo.exports.push({
                    name: 'default',
                    kind: 'default',
                    isTypeOnly: false,
                    line
                });
            }

            if (
                (ts.isFunctionDeclaration(node) ||
                 ts.isClassDeclaration(node) ||
                 ts.isInterfaceDeclaration(node) ||
                 ts.isTypeAliasDeclaration(node) ||
                 ts.isEnumDeclaration(node) ||
                 ts.isVariableStatement(node)) &&
                node.modifiers?.some(
                    modifier =>
                        modifier.kind ===
                        ts.SyntaxKind.ExportKeyword
                )
            ) {
                if (
                    ts.isVariableStatement(node)
                ) {
                    for (const declaration of
                        node.declarationList.declarations) {
                        if (ts.isIdentifier(declaration.name)) {
                            moduleInfo.exports.push({
                                name: declaration.name.text,
                                kind: 'named',
                                isTypeOnly: false,
                                line
                            });
                        }
                    }
                } else if (
                    'name' in node &&
                    node.name &&
                    ts.isIdentifier(node.name)
                ) {
                    moduleInfo.exports.push({
                        name: node.name.text,
                        kind: 'named',
                        isTypeOnly: false,
                        line
                    });
                }
            }

            const specifier = getModuleSpecifier(node);

            if (
                specifier &&
                (ts.isCallExpression(node) ||
                 ts.isImportDeclaration(node))
            ) {
                // CommonJS and dynamic imports are handled
                // separately below in a future enhancement.
            }

            ts.forEachChild(node, visit);
        }

        visit(sourceFile);

        modules.push(moduleInfo);
    }

    return {
        modules,
        unresolvedImports
    };
}
