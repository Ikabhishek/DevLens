import * as vscode from 'vscode';
import { ProjectModel } from '../models/projectModel';

export type ArchitectureCategory =
    | 'frontend'
    | 'backend'
    | 'database'
    | 'build-tool'
    | 'external-service';

export interface ArchitectureComponent {
    category: ArchitectureCategory;
    name: string;
    evidence: string;
}

export interface ArchitectureModel {
    components: ArchitectureComponent[];
    packageManager?: string;
}

type PackageJson = {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
};

const COMPONENTS: Array<{
    dependency: string;
    category: ArchitectureCategory;
    name: string;
}> = [
    { dependency: 'react', category: 'frontend', name: 'React' },
    { dependency: 'react-dom', category: 'frontend', name: 'React' },
    { dependency: 'vue', category: 'frontend', name: 'Vue' },
    { dependency: '@angular/core', category: 'frontend', name: 'Angular' },
    { dependency: 'svelte', category: 'frontend', name: 'Svelte' },
    { dependency: 'next', category: 'frontend', name: 'Next.js' },
    { dependency: 'express', category: 'backend', name: 'Express' },
    { dependency: '@nestjs/core', category: 'backend', name: 'NestJS' },
    { dependency: 'fastify', category: 'backend', name: 'Fastify' },
    { dependency: 'koa', category: 'backend', name: 'Koa' },
    { dependency: 'hono', category: 'backend', name: 'Hono' },
    { dependency: 'mongoose', category: 'database', name: 'MongoDB' },
    { dependency: 'mongodb', category: 'database', name: 'MongoDB' },
    { dependency: 'pg', category: 'database', name: 'PostgreSQL' },
    { dependency: 'postgres', category: 'database', name: 'PostgreSQL' },
    { dependency: 'mysql2', category: 'database', name: 'MySQL' },
    { dependency: 'sqlite3', category: 'database', name: 'SQLite' },
    { dependency: 'better-sqlite3', category: 'database', name: 'SQLite' },
    { dependency: 'firebase', category: 'external-service', name: 'Firebase' },
    { dependency: '@supabase/supabase-js', category: 'external-service', name: 'Supabase' },
    { dependency: '@aws-sdk/client-s3', category: 'external-service', name: 'AWS S3' },
    { dependency: 'vite', category: 'build-tool', name: 'Vite' },
    { dependency: 'webpack', category: 'build-tool', name: 'Webpack' },
    { dependency: 'tsup', category: 'build-tool', name: 'tsup' },
    { dependency: 'prisma', category: 'database', name: 'Prisma' }
];

export async function detectArchitecture(
    root: vscode.Uri,
    project: ProjectModel
): Promise<ArchitectureModel> {
    const components: ArchitectureComponent[] = [];
    const packageFile = project.files.find(file => file.relativePath === 'package.json');
    let packageJson: PackageJson | undefined;

    if (packageFile) {
        try {
            const content = await vscode.workspace.fs.readFile(
                vscode.Uri.joinPath(root, 'package.json')
            );
            packageJson = JSON.parse(Buffer.from(content).toString('utf8')) as PackageJson;
        } catch {
            // A malformed package file should not prevent other detection.
        }
    }

    const dependencies = new Set([
        ...Object.keys(packageJson?.dependencies ?? {}),
        ...Object.keys(packageJson?.devDependencies ?? {})
    ]);
    const seen = new Set<string>();
    for (const component of COMPONENTS) {
        if (!dependencies.has(component.dependency)) continue;
        const key = `${component.category}:${component.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        components.push({
            category: component.category,
            name: component.name,
            evidence: `package.json dependency: ${component.dependency}`
        });
    }

    const isMern = dependencies.has('react') && dependencies.has('express') &&
        (dependencies.has('mongoose') || dependencies.has('mongodb'));
    if (isMern) {
        const key = 'backend:MERN stack';
        if (!seen.has(key)) {
            components.push({
                category: 'backend',
                name: 'MERN stack',
                evidence: 'React, Express, and MongoDB/Mongoose dependencies'
            });
        }
    }

    if (project.configFiles.includes('vite.config.ts') || project.configFiles.includes('vite.config.js')) {
        const key = 'build-tool:Vite';
        if (!seen.has(key)) {
            components.push({
                category: 'build-tool',
                name: 'Vite',
                evidence: 'Vite configuration file'
            });
        }
    }

    const hasHtml = project.files.some(file => ['.html', '.htm'].includes(file.extension));
    const hasBrowserCode = project.files.some(file => ['.js', '.mjs', '.cjs'].includes(file.extension));
    const hasStyles = project.files.some(file => ['.css', '.scss', '.sass', '.less'].includes(file.extension));
    if (hasHtml && (hasBrowserCode || hasStyles)) {
        const key = 'frontend:HTML, CSS & JavaScript';
        if (!seen.has(key)) {
            components.push({
                category: 'frontend',
                name: 'HTML, CSS & JavaScript',
                evidence: 'Local HTML entry files with browser scripts or stylesheets'
            });
        }
    }

    components.sort((a, b) =>
        a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
    );

    return {
        components,
        packageManager: project.files.some(file => file.name === 'package-lock.json')
            ? 'npm'
            : project.files.some(file => file.name === 'yarn.lock')
                ? 'Yarn'
                : project.files.some(file => file.name === 'pnpm-lock.yaml')
                    ? 'pnpm'
                    : undefined
    };
}
