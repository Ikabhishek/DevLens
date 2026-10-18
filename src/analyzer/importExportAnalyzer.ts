
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

function normalizeRelativePath(filePath: string): string {
    return path.posix.normalize(filePath.replace(/\\/g, '/'));
}

const SCRIPT_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'
]);
const STYLESHEET_EXTENSIONS = new Set(['.css', '.scss', '.sass', '.less']);

function lineOf(text: string, index: number): number {
    return text.slice(0, index).split('\n').length;
}


function getImportNames(node: ts.ImportDeclaration): string[] {
    const source = ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : '';

    if (/\.(css|scss|sass|less)$/i.test(source)) {
        return ['stylesheet'];
    }

    const clause = node.importClause;

    if (!clause) {
        return [];
    }

    const names: string[] = [];

    if (clause.name) {
        names.push(clause.name.text);
        names.push('default');
    }

    const bindings = clause.namedBindings;

    if (bindings && ts.isNamespaceImport(bindings)) {
        names.push('*');
    } else if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
            names.push(
                element.propertyName?.text ?? element.name.text
            );
        }
    }

    return names;
}


function resolveLocalImport(
    source: string,
    importerRelativePath: string,
    knownFiles: Set<string>
): string | undefined {
    if (!source.startsWith('.')) {
        return undefined;
    }

    const base = normalizeRelativePath(
        path.posix.join(
            path.posix.dirname(importerRelativePath),
            source
        )
    );

    const extensions = [
        '.ts', '.tsx', '.js', '.jsx',
        '.mts', '.cts', '.mjs', '.cjs',
        '.json', '.html', '.htm', '.css', '.scss', '.sass', '.less'
    ];

    const indexFiles = extensions.map(ext =>
        path.posix.join(base, `index${ext}`)
    );

    const candidates = [
        base,
        ...extensions.map(ext => base + ext),
        ...indexFiles
    ];

    return candidates.find(candidate => knownFiles.has(candidate));
}

function addLocalReference(
    moduleInfo: FileModuleInfo,
    unresolvedImports: ImportExportAnalysis['unresolvedImports'],
    source: string,
    importedNames: string[],
    line: number,
    relativePath: string,
    knownFiles: Set<string>
): void {
    if (!source || source.startsWith('#') || /^(?:https?:|data:|\/\/)/i.test(source)) return;
    const cleanSource = source.split(/[?#]/, 1)[0];
    const resolvedPath = cleanSource.startsWith('/')
        ? normalizeRelativePath(cleanSource.slice(1))
        : resolveLocalImport(cleanSource.startsWith('.') ? cleanSource : `./${cleanSource}`, relativePath, knownFiles);
    const localPath = resolvedPath && knownFiles.has(resolvedPath)
        ? resolvedPath
        : undefined;
    moduleInfo.imports.push({
        source,
        resolvedPath: localPath,
        importedNames,
        isTypeOnly: false,
        isExternal: false,
        line
    });
    if (!localPath) {
        unresolvedImports.push({ filePath: relativePath, source, line });
    }
}

function analyzeHtmlReferences(
    sourceText: string,
    moduleInfo: FileModuleInfo,
    unresolvedImports: ImportExportAnalysis['unresolvedImports'],
    relativePath: string,
    knownFiles: Set<string>
): void {
    const referencePattern = /<(script|link)\b[^>]*>/gi;
    for (const match of sourceText.matchAll(referencePattern)) {
        const tag = match[0];
        const tagName = match[1].toLowerCase();
        const sourceMatch = tagName === 'script'
            ? /\bsrc\s*=\s*(["'])(.*?)\1/i.exec(tag)
            : /\bhref\s*=\s*(["'])(.*?)\1/i.exec(tag);
        if (!sourceMatch) continue;
        if (tagName === 'link' && !/\brel\s*=\s*(["'])stylesheet\1/i.test(tag)) continue;
        addLocalReference(
            moduleInfo,
            unresolvedImports,
            sourceMatch[2],
            [tagName === 'script' ? 'script' : 'stylesheet'],
            lineOf(sourceText, match.index ?? 0),
            relativePath,
            knownFiles
        );
    }
}

function analyzeStylesheetReferences(
    sourceText: string,
    moduleInfo: FileModuleInfo,
    unresolvedImports: ImportExportAnalysis['unresolvedImports'],
    relativePath: string,
    knownFiles: Set<string>
): void {
    const importPattern = /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?/gi;
    for (const match of sourceText.matchAll(importPattern)) {
        addLocalReference(
            moduleInfo, unresolvedImports, match[1], ['stylesheet'],
            lineOf(sourceText, match.index ?? 0), relativePath, knownFiles
        );
    }
}

export async function analyzeImportsAndExports(
    root: vscode.Uri,
    relativePaths: string[],
    knownRelativePaths: string[] = relativePaths
): Promise<ImportExportAnalysis> {
    const normalizedPaths = relativePaths.map(normalizeRelativePath);
    const knownFiles = new Set(knownRelativePaths.map(normalizeRelativePath));

    const modules: FileModuleInfo[] = [];
    const unresolvedImports: ImportExportAnalysis['unresolvedImports'] = [];

    for (const relativePath of normalizedPaths) {
        const extension = path.posix.extname(relativePath).toLowerCase();

        if (!SCRIPT_EXTENSIONS.has(extension) &&
            extension !== '.html' && extension !== '.htm' &&
            !STYLESHEET_EXTENSIONS.has(extension)) {
            continue;
        }

        const uri = vscode.Uri.joinPath(
            root,
            ...relativePath.split('/')
        );

        let content: Uint8Array;

        try {
            content = await vscode.workspace.fs.readFile(uri);
        } catch {
            continue;
        }

        const sourceText = Buffer.from(content).toString('utf8');

        const scriptKind =
            extension === '.tsx' ? ts.ScriptKind.TSX :
            extension === '.jsx' ? ts.ScriptKind.JSX :
            ['.js', '.mjs', '.cjs'].includes(extension)
                ? ts.ScriptKind.JS
                : ts.ScriptKind.TS;

        const sourceFile = ts.createSourceFile(
            relativePath,
            sourceText,
            ts.ScriptTarget.Latest,
            true,
            scriptKind
        );

        const moduleInfo: FileModuleInfo = {
            filePath: relativePath,
            imports: [],
            exports: []
        };

        if (extension === '.html' || extension === '.htm') {
            analyzeHtmlReferences(sourceText, moduleInfo, unresolvedImports, relativePath, knownFiles);
            modules.push(moduleInfo);
            continue;
        }
        if (STYLESHEET_EXTENSIONS.has(extension)) {
            analyzeStylesheetReferences(sourceText, moduleInfo, unresolvedImports, relativePath, knownFiles);
            modules.push(moduleInfo);
            continue;
        }

        function visit(node: ts.Node): void {
            const line =
                sourceFile.getLineAndCharacterOfPosition(
                    node.getStart(sourceFile)
                ).line + 1;

            if (
                ts.isImportDeclaration(node) &&
                ts.isStringLiteral(node.moduleSpecifier)
            ) {
                const source = node.moduleSpecifier.text;
                const isRelative = source.startsWith('.');
                const resolvedPath = resolveLocalImport(
                    source,
                    relativePath,
                    knownFiles
                );

                moduleInfo.imports.push({
                    source,
                    resolvedPath,
                    importedNames: getImportNames(node),
                    isTypeOnly: node.importClause?.isTypeOnly ?? false,
                    isExternal: !isRelative,
                    line
                });

                if (isRelative && !resolvedPath) {
                    unresolvedImports.push({
                        filePath: relativePath,
                        source,
                        line
                    });
                }
            }

            if (ts.isExportDeclaration(node)) {
                const source =
                    node.moduleSpecifier &&
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
                } else if (
                    node.exportClause &&
                    ts.isNamedExports(node.exportClause)
                ) {
                    for (const element of node.exportClause.elements) {
                        moduleInfo.exports.push({
                            name: element.name.text,
                            kind: 'named',
                            isTypeOnly:
                                node.isTypeOnly || element.isTypeOnly,
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
                        modifier.kind === ts.SyntaxKind.ExportKeyword
                )
            ) {
                if (ts.isVariableStatement(node)) {
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

            ts.forEachChild(node, visit);
        }

        visit(sourceFile);
        modules.push(moduleInfo);
    }

    return { modules, unresolvedImports };
}
