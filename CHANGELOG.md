# Changelog

All notable changes to DevLens are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses [Semantic Versioning](https://semver.org/).

## [1.0.5] - 2026-11-23

### Added

- **Multi-Page Executive PDF Report Engine**: Complete architectural report generator producing structured, executive-grade PDF documents with vector graphics and rich codebase insights.
- **Visual Code Architecture Diagram in PDF**: Dedicated vector diagram in the PDF report rendering a topological 4-tier dependency map (Entry & Pages, Components, Services, and Modules) with bezier connector curves and flow arrowheads.
- **Critical Modules & Refactoring Impact Matrix**: Centrality analysis table in the PDF report displaying inbound/outbound connections, module roles, and color-coded impact risk badges (`HIGH RISK`, `MODERATE`, `LOW / LEAF`).
- **DevLens Vector Logo Integration**: Embedded official DevLens vector logo in report headers, rendered as pure vector graphics.
- **Language Composition Stacked Bar Chart**: Visual horizontal stacked bar chart in the PDF report displaying proportional language distribution with an accompanying color-coded legend grid.
- **Actionable Architectural Insights**: Automated observations on refactoring precautions for critical hubs, component decoupling, and test coverage priorities.

### Changed

- Replaced previous plain-text PDF export with a 3-page styled PDF document featuring dark theme header banners, KPI metric cards, and clean typography.
- Updated project scanner directory exclusions (`IGNORED_DIRECTORIES`) to ignore `.angular`, `.cache`, `.turbo`, `.output`, `.parcel-cache`, and `.vite` build directories.

### Fixed

- Fixed category filter pills, file search input, and dependency highlighting in the dashboard architecture graph where CSS animation fill-mode was overriding the dimming state and preventing visual filtering.
- Fixed edge arrows overlapping column header titles in the "Group by Type" dashboard architecture view by introducing horizontal side-to-side edge routing and increasing header clearance.
- Resolved broken bullet point characters (`?`) in PDF reports caused by non-ASCII character sanitization by replacing them with native vector bullet elements.
- Excluded internal build cache artifacts (such as `.angular/cache/...` chunks) from the most connected modules list and dependency graph analysis.

### Planned

- Broader framework and language analysis coverage.

## [1.0.4] - 2026-11-21

### Added

- Project dashboard in the VS Code editor area with live workspace statistics, language breakdown, project metadata, and quick access to DevLens analysis tools.
- Downloadable PDF project report with workspace statistics, languages, detected architecture, analysis totals, and the most connected modules.
- Interactive architecture graph with file search, zoom, fit-to-screen, pan, layout options, dependency highlighting, node selection, edge inspection, and direct file opening.
- Graph motion for dashboard architecture maps: staggered node and edge entry, selected-node pulse, and animated dependency-flow edges.
- File-level dependency analysis for TypeScript, JavaScript, React, Angular, HTML, and stylesheet files.
- HTML and CSS project support:
  - Resolves local HTML script and stylesheet references.
  - Resolves local CSS `@import` relationships.
  - Displays HTML and stylesheet files in architecture graphs.
  - Detects plain HTML, CSS, and JavaScript projects without applying that label to projects using a recognised frontend framework.
- Symbol analysis for TypeScript and JavaScript functions, classes, methods, variables, calls, imports, and exports.
- Code relationship explorer, “Why Is This Code Here?”, impact analysis, and execution-flow tracing commands.
- HTTP request and route analysis for supported frontend and backend code.
- Angular analysis for components, services, modules, constructor-injected dependencies, and static route definitions.
- MERN analysis for stack detection, Express controller handlers, Mongoose models, and controller-to-model relationships.
- Project architecture detection for common frontend frameworks, backend frameworks, databases, build tools, and external services.
- Workspace file watcher with cached incremental analysis.
- Configurable directory exclusions and flow trace depth settings.

### Changed

- Reworked the DevLens activity-bar experience so selecting DevLens opens the editor dashboard while the sidebar continues to provide the project tree.
- Improved graph filtering to omit generated directories and non-code assets from architecture views.
- Updated graph rendering to use VS Code theme colours and DevLens accent colours.
- Improved local import resolution, including default imports and browser-relative asset references.

### Fixed

- Removed an SVG edge fill that could render as black shapes in the architecture graph.
- Preserved the complete project file set during incremental dependency resolution.
- Detect frameworks across nested package manifests, including repositories with separate frontend and backend packages.
- Restored dashboard graph controls with resilient event handling and visible action feedback.

[Unreleased]: https://github.com/Ikabhishek/DevLens/compare/v1.0.4...HEAD
[1.0.4]: https://github.com/Ikabhishek/DevLens/releases/tag/v1.0.4
[1.0.3]: https://github.com/Ikabhishek/DevLens/releases/tag/v1.0.3
