# DevLens

> Understand your codebase through architecture and code relationships.

DevLens is a Visual Studio Code extension that helps developers understand an unfamiliar codebase by scanning project files, extracting code relationships, analyzing dependencies, and visualizing architecture and execution flows.

## Highlights

- **Project overview dashboard** with file statistics, language breakdown, configuration files, detected technologies, and connected modules.
- **Deep code intelligence** for TypeScript and JavaScript using AST-based analysis.
- **Code relationship analysis** for exploring symbols, callers, dependencies, and references.
- **Impact analysis** to investigate code that may be affected by changes.
- **Architecture visualization** to explore file-level dependencies and project structure.
- **Flow tracing** that connects supported HTTP client calls to recognized backend routes.
- **Framework and technology detection** based on dependencies, configuration files, and lockfiles.
- **Project scanning** with file classification and language statistics.

## Supported Analysis

### 1. Deep code intelligence and AST analysis

Deep symbol extraction and relationship analysis currently support these file extensions:

| Ecosystem | Extensions | Supported capabilities |
|---|---|---|
| TypeScript | `.ts`, `.tsx`, `.mts`, `.cts` | Functions, classes, methods, variables, interfaces, type aliases, enums, parameters, return expressions, and imports/exports |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | CommonJS and ES module imports/exports, function declarations, arrow functions, class declarations, and method calls |

### 2. Framework-aware semantic recognition

DevLens includes dedicated pattern extractors in its AST and HTTP analysis.

**Angular**
- Detects `@Component`, `@Injectable`, and `@NgModule`.
- Analyzes constructor-based dependency injection (`injectedDependencies`).
- Recognizes route-to-component mappings in `RouterModule` route configurations.

**Express**
- Recognizes controller and router handlers such as `app.get()` and `router.post()`.
- Detects sub-router mounting and resolves prefixes, such as `app.use('/api', router)`.

**React**
- Extracts component hierarchy and JSX component relationships, such as `<Component />`.

**Mongoose / MongoDB**
- Recognizes schema and model declarations using `mongoose.model()`.

**HTTP client-to-server tracing**
- Recognizes supported calls such as `fetch()`, `axios.get()` / `axios.post()`, `http.request`, and `https.request`.
- Links recognized client requests to supported backend API routes when the analyzer can resolve the relationship.

## Architecture and Technology Detection

DevLens detects technologies from project dependencies, configuration files, and lockfiles.

| Category | Detected technologies |
|---|---|
| Frontend frameworks | React, Vue, Angular, Svelte, Next.js |
| Backend frameworks | Express, NestJS, Fastify, Koa, Hono |
| Databases and ORMs | MongoDB (native and Mongoose), PostgreSQL (`pg`), MySQL (`mysql2`), SQLite (`sqlite3`, `better-sqlite3`), Prisma |
| External services and cloud | Firebase, Supabase, AWS S3 |
| Build tools | Vite, Webpack, tsup |
| Package managers | npm, Yarn, pnpm, Bun |

Technology detection indicates that project configuration or dependencies match supported patterns; it does not necessarily mean every feature of a detected technology is deeply analyzed.

## Project Scanner and File Classification

The scanner classifies **22 file types/language labels** for project statistics, the language distribution chart, and the project tree.

- **Languages:** TypeScript, JavaScript, Python, Java, C, C++, C#, PHP, Go, Rust, Dart
- **Web and styles:** HTML, CSS, SCSS
- **Data and configuration:** JSON, Markdown, SQL, XML, YAML
- **Scripts:** Shell (`.sh`), Batch (`.bat`), PowerShell (`.ps1`)

> **Important:** File classification is broader than deep code analysis. Python and Dart files can be counted and classified by the scanner, but full AST-based symbol extraction and relationship analysis are currently documented for TypeScript and JavaScript extensions only.

## Using DevLens

1. Open a project folder in Visual Studio Code.
2. Open DevLens from the Activity Bar.
3. Open the DevLens dashboard to review project statistics and detected technologies.
4. Use the available tools to explore architecture, code relationships, impact analysis, and supported execution flows.
5. Refresh the dashboard after making changes to update the project analysis.

Exact commands and views may vary by the installed version of the extension.

## Development

To work on the extension locally:

1. Clone this repository.
2. Install the project dependencies:
   ```bash
   npm install
   ```
3. Compile the extension:
   ```bash
   npm run compile
   ```
4. Open the project in Visual Studio Code and press **F5** to launch an Extension Development Host.

Use the scripts defined in `package.json` for linting and tests. Before contributing, run the project's available checks and confirm the extension works in the Extension Development Host.

## Current Scope and Limitations

- Deep AST-based code analysis is currently focused on TypeScript and JavaScript.
- Framework-aware recognition uses supported code patterns; dynamic behavior and framework conventions that cannot be resolved statically may not be fully represented.
- Client-to-server flow links are reported when request details and backend routes can be matched by the current analyzer.
- Technology detection and file classification do not imply full semantic support for every listed technology or language.
- Static analysis describes relationships inferred from source code; it does not guarantee the exact runtime execution path.

## Contributing

Contributions and bug reports are welcome. When reporting an issue, include:
- The language or framework involved.
- A small reproducible example, if possible.
- The expected result and the result DevLens produced.
- Relevant error messages and steps to reproduce.

## License

This project is licensed under the MIT License.
See the [LICENSE](LICENSE) file for details.
---

**DevLens** — Explore your codebase. Understand its relationships. Trace how it works.
