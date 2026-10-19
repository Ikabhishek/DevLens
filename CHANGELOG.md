# Changelog

All notable changes to DevLens are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned

- Broader framework and language analysis coverage.

## [1.0.2] - 2026-10-19

### Added

- Project dashboard in the VS Code editor area with live workspace statistics, language breakdown, project metadata, and quick access to DevLens analysis tools.
- Interactive architecture graph with file search, zoom, fit-to-screen, pan, layout options, dependency highlighting, node selection, edge inspection, and direct file opening.
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

[Unreleased]: https://github.com/Ikabhishek/DevLens/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/Ikabhishek/DevLens/releases/tag/v1.0.2
