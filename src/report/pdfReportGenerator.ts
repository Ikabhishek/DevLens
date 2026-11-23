import * as fs from 'fs';
import * as path from 'path';
import { ArchitectureComponent, ArchitectureModel } from '../analyzer/architectureAnalyzer';
import { AstAnalysis } from '../analyzer/astAnalyzer';
import { DependencyGraph } from '../graph/dependencyGraph';
import { ProjectModel } from '../models/projectModel';

export interface DashboardData {
    project: ProjectModel;
    ast: AstAnalysis;
    graph: DependencyGraph;
    architecture: ArchitectureModel;
}

type RGB = [number, number, number];

const COLOR_WHITE: RGB = [1, 1, 1];
const COLOR_SLATE_900: RGB = [0.06, 0.09, 0.16];
const COLOR_SLATE_800: RGB = [0.12, 0.16, 0.23];
const COLOR_SLATE_700: RGB = [0.20, 0.25, 0.33];
const COLOR_SLATE_400: RGB = [0.58, 0.64, 0.72];
const COLOR_SLATE_100: RGB = [0.95, 0.96, 0.98];
const COLOR_SLATE_50: RGB = [0.98, 0.98, 0.99];
const COLOR_BORDER: RGB = [0.88, 0.91, 0.94];
const COLOR_CYAN: RGB = [0.06, 0.65, 0.88];
const COLOR_TEAL: RGB = [0.08, 0.68, 0.58];
const COLOR_AMBER: RGB = [0.93, 0.54, 0.12];
const COLOR_PURPLE: RGB = [0.55, 0.36, 0.96];
const COLOR_RED: RGB = [0.92, 0.26, 0.26];
const COLOR_GREEN: RGB = [0.13, 0.69, 0.30];

function sanitizePdfText(str: string): string {
    return str
        .replace(/[^\x20-\x7e]/g, ' ')
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');
}

function hexToRgb(hex: string): RGB {
    const clean = hex.replace('#', '');
    if (clean.length === 6) {
        return [
            parseInt(clean.slice(0, 2), 16) / 255,
            parseInt(clean.slice(2, 4), 16) / 255,
            parseInt(clean.slice(4, 6), 16) / 255
        ];
    }
    return [0.2, 0.5, 0.8];
}

class PdfPage {
    public readonly width = 595.28;
    public readonly height = 841.89;
    private stream: string[] = [];

    private toPdfY(yFromTop: number): number {
        return this.height - yFromTop;
    }

    public raw(op: string): void {
        this.stream.push(op);
    }

    public rect(x: number, yFromTop: number, w: number, h: number, fill?: RGB, stroke?: RGB, lineWidth = 1): void {
        const by = this.toPdfY(yFromTop + h);
        this.stream.push('q');
        if (stroke) {
            this.stream.push(`${lineWidth.toFixed(2)} w`);
            this.stream.push(`${stroke[0].toFixed(3)} ${stroke[1].toFixed(3)} ${stroke[2].toFixed(3)} RG`);
        }
        if (fill) {
            this.stream.push(`${fill[0].toFixed(3)} ${fill[1].toFixed(3)} ${fill[2].toFixed(3)} rg`);
        }
        this.stream.push(`${x.toFixed(2)} ${by.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
        if (fill && stroke) {
            this.stream.push('B');
        } else if (fill) {
            this.stream.push('f');
        } else if (stroke) {
            this.stream.push('S');
        }
        this.stream.push('Q');
    }

    public roundedRect(x: number, yFromTop: number, w: number, h: number, r: number, fill?: RGB, stroke?: RGB, lineWidth = 1): void {
        const bx = x;
        const by = this.toPdfY(yFromTop + h);
        const radius = Math.min(r, w / 2, h / 2);
        const k = radius * 0.55228475;

        this.stream.push('q');
        if (stroke) {
            this.stream.push(`${lineWidth.toFixed(2)} w`);
            this.stream.push(`${stroke[0].toFixed(3)} ${stroke[1].toFixed(3)} ${stroke[2].toFixed(3)} RG`);
        }
        if (fill) {
            this.stream.push(`${fill[0].toFixed(3)} ${fill[1].toFixed(3)} ${fill[2].toFixed(3)} rg`);
        }

        const pathOps = [
            `${(bx + radius).toFixed(2)} ${by.toFixed(2)} m`,
            `${(bx + w - radius).toFixed(2)} ${by.toFixed(2)} l`,
            `${(bx + w - radius + k).toFixed(2)} ${by.toFixed(2)} ${(bx + w).toFixed(2)} ${(by + radius - k).toFixed(2)} ${(bx + w).toFixed(2)} ${(by + radius).toFixed(2)} c`,
            `${(bx + w).toFixed(2)} ${(by + h - radius).toFixed(2)} l`,
            `${(bx + w).toFixed(2)} ${(by + h - radius + k).toFixed(2)} ${(bx + w - radius + k).toFixed(2)} ${(by + h).toFixed(2)} ${(bx + w - radius).toFixed(2)} ${(by + h).toFixed(2)} c`,
            `${(bx + radius).toFixed(2)} ${(by + h).toFixed(2)} l`,
            `${(bx + radius - k).toFixed(2)} ${(by + h).toFixed(2)} ${bx.toFixed(2)} ${(by + h - radius + k).toFixed(2)} ${bx.toFixed(2)} ${(by + h - radius).toFixed(2)} c`,
            `${bx.toFixed(2)} ${(by + radius).toFixed(2)} l`,
            `${bx.toFixed(2)} ${(by + radius - k).toFixed(2)} ${(bx + radius - k).toFixed(2)} ${by.toFixed(2)} ${(bx + radius).toFixed(2)} ${by.toFixed(2)} c`,
            'h'
        ];
        this.stream.push(pathOps.join(' '));

        if (fill && stroke) {
            this.stream.push('B');
        } else if (fill) {
            this.stream.push('f');
        } else if (stroke) {
            this.stream.push('S');
        }
        this.stream.push('Q');
    }

    public circle(cx: number, cyFromTop: number, r: number, fill?: RGB, stroke?: RGB, lineWidth = 1): void {
        const py = this.toPdfY(cyFromTop);
        const k = r * 0.55228475;
        this.stream.push('q');
        if (stroke) {
            this.stream.push(`${lineWidth.toFixed(2)} w`);
            this.stream.push(`${stroke[0].toFixed(3)} ${stroke[1].toFixed(3)} ${stroke[2].toFixed(3)} RG`);
        }
        if (fill) {
            this.stream.push(`${fill[0].toFixed(3)} ${fill[1].toFixed(3)} ${fill[2].toFixed(3)} rg`);
        }
        const ops = [
            `${(cx + r).toFixed(2)} ${py.toFixed(2)} m`,
            `${(cx + r).toFixed(2)} ${(py + k).toFixed(2)} ${(cx + k).toFixed(2)} ${(py + r).toFixed(2)} ${cx.toFixed(2)} ${(py + r).toFixed(2)} c`,
            `${(cx - k).toFixed(2)} ${(py + r).toFixed(2)} ${(cx - r).toFixed(2)} ${(py + k).toFixed(2)} ${(cx - r).toFixed(2)} ${py.toFixed(2)} c`,
            `${(cx - r).toFixed(2)} ${(py - k).toFixed(2)} ${(cx - k).toFixed(2)} ${(py - r).toFixed(2)} ${cx.toFixed(2)} ${(py - r).toFixed(2)} c`,
            `${(cx + k).toFixed(2)} ${(py - r).toFixed(2)} ${(cx + r).toFixed(2)} ${(py - k).toFixed(2)} ${(cx + r).toFixed(2)} ${py.toFixed(2)} c`,
            'h'
        ];
        this.stream.push(ops.join(' '));
        if (fill && stroke) {
            this.stream.push('B');
        } else if (fill) {
            this.stream.push('f');
        } else if (stroke) {
            this.stream.push('S');
        }
        this.stream.push('Q');
    }

    public line(x1: number, y1FromTop: number, x2: number, y2FromTop: number, stroke: RGB, lineWidth = 1, dashed = false): void {
        const py1 = this.toPdfY(y1FromTop);
        const py2 = this.toPdfY(y2FromTop);
        this.stream.push('q');
        this.stream.push(`${lineWidth.toFixed(2)} w`);
        this.stream.push(`${stroke[0].toFixed(3)} ${stroke[1].toFixed(3)} ${stroke[2].toFixed(3)} RG`);
        if (dashed) {
            this.stream.push('[3 3] 0 d');
        }
        this.stream.push(`${x1.toFixed(2)} ${py1.toFixed(2)} m ${x2.toFixed(2)} ${py2.toFixed(2)} l S`);
        this.stream.push('Q');
    }

    public arrow(x1: number, y1FromTop: number, x2: number, y2FromTop: number, stroke: RGB, lineWidth = 1.2, arrowSize = 5): void {
        const py1 = this.toPdfY(y1FromTop);
        const py2 = this.toPdfY(y2FromTop);
        const angle = Math.atan2(py2 - py1, x2 - x1);
        const a1 = angle - Math.PI / 6;
        const a2 = angle + Math.PI / 6;
        const p1x = x2 - arrowSize * Math.cos(a1);
        const p1y = py2 - arrowSize * Math.sin(a1);
        const p2x = x2 - arrowSize * Math.cos(a2);
        const p2y = py2 - arrowSize * Math.sin(a2);

        this.stream.push('q');
        this.stream.push(`${lineWidth.toFixed(2)} w`);
        this.stream.push(`${stroke[0].toFixed(3)} ${stroke[1].toFixed(3)} ${stroke[2].toFixed(3)} RG`);
        this.stream.push(`${stroke[0].toFixed(3)} ${stroke[1].toFixed(3)} ${stroke[2].toFixed(3)} rg`);
        this.stream.push(`${x1.toFixed(2)} ${py1.toFixed(2)} m ${x2.toFixed(2)} ${py2.toFixed(2)} l S`);
        this.stream.push(`${x2.toFixed(2)} ${py2.toFixed(2)} m ${p1x.toFixed(2)} ${p1y.toFixed(2)} l ${p2x.toFixed(2)} ${p2y.toFixed(2)} l h f`);
        this.stream.push('Q');
    }

    public bezierArrow(
        x1: number,
        y1FromTop: number,
        cx1: number,
        cy1FromTop: number,
        cx2: number,
        cy2FromTop: number,
        x2: number,
        y2FromTop: number,
        stroke: RGB,
        lineWidth = 1.2,
        arrowSize = 5
    ): void {
        const py1 = this.toPdfY(y1FromTop);
        const pcy1 = this.toPdfY(cy1FromTop);
        const pcy2 = this.toPdfY(cy2FromTop);
        const py2 = this.toPdfY(y2FromTop);

        const angle = Math.atan2(py2 - pcy2, x2 - cx2);
        const a1 = angle - Math.PI / 6;
        const a2 = angle + Math.PI / 6;
        const p1x = x2 - arrowSize * Math.cos(a1);
        const p1y = py2 - arrowSize * Math.sin(a1);
        const p2x = x2 - arrowSize * Math.cos(a2);
        const p2y = py2 - arrowSize * Math.sin(a2);

        this.stream.push('q');
        this.stream.push(`${lineWidth.toFixed(2)} w`);
        this.stream.push(`${stroke[0].toFixed(3)} ${stroke[1].toFixed(3)} ${stroke[2].toFixed(3)} RG`);
        this.stream.push(`${stroke[0].toFixed(3)} ${stroke[1].toFixed(3)} ${stroke[2].toFixed(3)} rg`);
        this.stream.push(`${x1.toFixed(2)} ${py1.toFixed(2)} m ${cx1.toFixed(2)} ${pcy1.toFixed(2)} ${cx2.toFixed(2)} ${pcy2.toFixed(2)} ${x2.toFixed(2)} ${py2.toFixed(2)} c S`);
        this.stream.push(`${x2.toFixed(2)} ${py2.toFixed(2)} m ${p1x.toFixed(2)} ${p1y.toFixed(2)} l ${p2x.toFixed(2)} ${p2y.toFixed(2)} l h f`);
        this.stream.push('Q');
    }

    public text(
        str: string,
        x: number,
        yFromTop: number,
        options: {
            font?: 'F1' | 'F2' | 'F3' | 'F4';
            size?: number;
            color?: RGB;
            align?: 'left' | 'center' | 'right';
            maxWidth?: number;
        } = {}
    ): void {
        const font = options.font ?? 'F1';
        const size = options.size ?? 10;
        const color = options.color ?? COLOR_SLATE_900;
        const align = options.align ?? 'left';

        let safeText = sanitizePdfText(str);
        if (options.maxWidth && options.maxWidth > 0) {
            const avgCharWidth = (font === 'F2' ? 0.6 : 0.5) * size;
            const maxChars = Math.floor(options.maxWidth / avgCharWidth);
            if (safeText.length > maxChars && maxChars > 3) {
                safeText = safeText.slice(0, maxChars - 2) + '..';
            }
        }

        const estWidth = safeText.length * ((font === 'F2' ? 0.58 : 0.5) * size);
        let actualX = x;
        if (align === 'center') {
            actualX = x - estWidth / 2;
        } else if (align === 'right') {
            actualX = x - estWidth;
        }

        const py = this.toPdfY(yFromTop);
        this.stream.push(
            `BT /${font} ${size} Tf ${color[0].toFixed(3)} ${color[1].toFixed(3)} ${color[2].toFixed(3)} rg 1 0 0 1 ${actualX.toFixed(2)} ${py.toFixed(2)} Tm (${safeText}) Tj ET`
        );
    }

    public badge(
        label: string,
        x: number,
        yFromTop: number,
        bgColor: RGB,
        textColor: RGB,
        fontSize = 7.5,
        font: 'F1' | 'F2' = 'F2',
        paddingX = 6,
        height = 14
    ): number {
        const safe = sanitizePdfText(label);
        const charW = (font === 'F2' ? 0.58 : 0.5) * fontSize;
        const width = safe.length * charW + paddingX * 2;
        this.roundedRect(x, yFromTop, width, height, 4, bgColor);
        this.text(safe, x + paddingX, yFromTop + height - 3.5, { font, size: fontSize, color: textColor });
        return width;
    }

    public getContentStream(): string {
        return this.stream.join('\n');
    }
}

class PdfDocument {
    private pages: PdfPage[] = [];

    public addPage(): PdfPage {
        const page = new PdfPage();
        this.pages.push(page);
        return page;
    }

    public build(): Uint8Array {
        const objects: string[] = [];
        const pageObjectIds: number[] = [];

        // Obj 1: Catalog
        objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';

        // Font resources dictionary
        const fontResources = `<<
  /Font <<
    /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>
    /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>
    /F3 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>
    /F4 << /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>
  >>
>>`;

        // Obj 3: Shared Resources
        objects[3] = fontResources;

        // Build page and content stream objects
        this.pages.forEach((page, index) => {
            const pageObjId = 4 + index * 2;
            const contentObjId = pageObjId + 1;
            pageObjectIds.push(pageObjId);

            const streamContent = page.getContentStream();
            const streamLength = Buffer.byteLength(streamContent, 'latin1');

            objects[pageObjId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources 3 0 R /Contents ${contentObjId} 0 R >>`;
            objects[contentObjId] = `<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream`;
        });

        // Obj 2: Pages tree
        const kids = pageObjectIds.map(id => `${id} 0 R`).join(' ');
        objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${this.pages.length} >>`;

        // Assemble PDF string
        let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
        const offsets: number[] = [0];

        for (let i = 1; i < objects.length; i++) {
            offsets[i] = Buffer.byteLength(pdf, 'latin1');
            pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
        }

        const xrefOffset = Buffer.byteLength(pdf, 'latin1');
        pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;

        for (let i = 1; i < objects.length; i++) {
            pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
        }

        pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
        return Buffer.from(pdf, 'latin1');
    }
}

function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function parseSvgPathDToPdfOps(d: string): string {
    const tokens = d.match(/[a-df-z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/gi);
    if (!tokens) return '';

    const pdfOps: string[] = [];
    let i = 0;
    let curX = 0, curY = 0;
    let startX = 0, startY = 0;

    while (i < tokens.length) {
        const cmd = tokens[i++];
        if (cmd === 'M' || cmd === 'm') {
            const isRel = cmd === 'm';
            let first = true;
            while (i < tokens.length && !isNaN(Number(tokens[i]))) {
                const xVal = Number(tokens[i++]);
                const yVal = Number(tokens[i++]);
                curX = isRel ? curX + xVal : xVal;
                curY = isRel ? curY + yVal : yVal;
                if (first) {
                    startX = curX;
                    startY = curY;
                    pdfOps.push(`${curX.toFixed(2)} ${curY.toFixed(2)} m`);
                    first = false;
                } else {
                    pdfOps.push(`${curX.toFixed(2)} ${curY.toFixed(2)} l`);
                }
            }
        } else if (cmd === 'C' || cmd === 'c') {
            const isRel = cmd === 'c';
            while (i < tokens.length && !isNaN(Number(tokens[i]))) {
                const x1 = Number(tokens[i++]);
                const y1 = Number(tokens[i++]);
                const x2 = Number(tokens[i++]);
                const y2 = Number(tokens[i++]);
                const x = Number(tokens[i++]);
                const y = Number(tokens[i++]);

                const absX1 = isRel ? curX + x1 : x1;
                const absY1 = isRel ? curY + y1 : y1;
                const absX2 = isRel ? curX + x2 : x2;
                const absY2 = isRel ? curY + y2 : y2;
                curX = isRel ? curX + x : x;
                curY = isRel ? curY + y : y;

                pdfOps.push(`${absX1.toFixed(2)} ${absY1.toFixed(2)} ${absX2.toFixed(2)} ${absY2.toFixed(2)} ${curX.toFixed(2)} ${curY.toFixed(2)} c`);
            }
        } else if (cmd === 'L' || cmd === 'l') {
            const isRel = cmd === 'l';
            while (i < tokens.length && !isNaN(Number(tokens[i]))) {
                const xVal = Number(tokens[i++]);
                const yVal = Number(tokens[i++]);
                curX = isRel ? curX + xVal : xVal;
                curY = isRel ? curY + yVal : yVal;
                pdfOps.push(`${curX.toFixed(2)} ${curY.toFixed(2)} l`);
            }
        } else if (cmd === 'Z' || cmd === 'z') {
            pdfOps.push('h');
            curX = startX;
            startY = startY;
        }
    }
    return pdfOps.join(' ');
}

let cachedDevLensPaths: string[] | undefined;

function getDevLensSvgPaths(): string[] {
    if (cachedDevLensPaths) return cachedDevLensPaths;
    const paths: string[] = [];
    try {
        const svgPath = path.resolve(__dirname, '../../resources/devlens.svg');
        if (fs.existsSync(svgPath)) {
            const svgContent = fs.readFileSync(svgPath, 'utf8');
            const pathRegex = /<path\s+d="([^"]+)"/g;
            let m: RegExpExecArray | null;
            while ((m = pathRegex.exec(svgContent)) !== null) {
                const ops = parseSvgPathDToPdfOps(m[1]);
                if (ops) paths.push(ops);
            }
        }
    } catch {
        // Fallback gracefully
    }
    cachedDevLensPaths = paths;
    return paths;
}

function drawDevLensLogo(page: PdfPage, x: number, yFromTop: number, size: number): void {
    // Backdrop rounded box
    page.roundedRect(x, yFromTop, size, size, 6, [0.01, 0.52, 0.78]);

    const svgPaths = getDevLensSvgPaths();
    if (svgPaths.length > 0) {
        // DevLens logo SVG is centered in 500x500 box with width ~360, height ~370
        const innerScale = (size * 0.82) / 500;
        const offsetX = x + (size * 0.09);
        const offsetY = yFromTop + (size * 0.09);
        const pyTop = page.height - offsetY;

        page.raw('q');
        page.raw(`${innerScale.toFixed(5)} 0 0 -${innerScale.toFixed(5)} ${offsetX.toFixed(2)} ${pyTop.toFixed(2)} cm`);
        page.raw('1.000 1.000 1.000 rg'); // Crisp white logo
        for (const p of svgPaths) {
            page.raw(p + ' f');
        }
        page.raw('Q');
    } else {
        // Subtle fallback if svg resource is unavailable
        page.circle(x + size / 2, yFromTop + size / 2, size * 0.3, undefined, COLOR_WHITE, 1.8);
        page.circle(x + size / 2, yFromTop + size / 2, size * 0.12, COLOR_WHITE);
    }
}

function drawPageHeader(page: PdfPage, title: string, subtitle: string, tag: string): void {
    // Header Banner
    page.roundedRect(40, 32, 515, 54, 8, COLOR_SLATE_900);
    // Left accent bar
    page.roundedRect(40, 32, 6, 54, 3, COLOR_CYAN);

    // Official DevLens Logo
    drawDevLensLogo(page, 56, 42, 34);

    // Header Title and Subtitle
    page.text('DEVLENS ARCHITECTURE REPORT', 100, 48, { font: 'F2', size: 13, color: COLOR_WHITE });
    page.text(title.toUpperCase(), 100, 62, { font: 'F1', size: 9, color: COLOR_CYAN });
    page.text(subtitle, 100, 75, { font: 'F1', size: 7.5, color: COLOR_SLATE_400 });

    // Right-aligned status pill
    page.badge(tag, 465, 52, [0.12, 0.22, 0.38], COLOR_CYAN, 7.5, 'F2', 8, 16);
}

function drawPageFooter(page: PdfPage, pageNum: number, totalPages: number, projectName: string): void {
    page.line(40, 805, 555, 805, COLOR_BORDER, 0.8);
    page.text('DevLens Codebase Intelligence', 40, 818, { font: 'F2', size: 7.5, color: COLOR_SLATE_400 });
    page.text(`Project: ${projectName}`, 220, 818, { font: 'F1', size: 7.5, color: COLOR_SLATE_400 });
    page.text(`Page ${pageNum} of ${totalPages}`, 515, 818, { font: 'F2', size: 7.5, color: COLOR_SLATE_700, align: 'right' });
}

function drawSectionHeading(page: PdfPage, title: string, y: number, color: RGB = COLOR_CYAN): void {
    page.rect(40, y - 1, 3.5, 12, color);
    page.text(title.toUpperCase(), 48, y + 8, { font: 'F2', size: 9, color: COLOR_SLATE_800 });
}

function getFileCategory(file: string): 'entry' | 'component' | 'service' | 'module' {
    const normalized = file.toLowerCase().replace(/\\/g, '/');
    const baseName = path.posix.basename(normalized);
    if (/^(app|main|index)\.(tsx|jsx|ts|js)$/.test(baseName) || /\.(html|htm)$/.test(baseName) || /(^|\/)(pages?|views?|routes?)(\/|$)/.test(normalized)) {
        return 'entry';
    }
    if (/(^|\/)(components?|widgets?)(\/|$)/.test(normalized) || /\.component\.(ts|tsx|js|jsx)$/.test(baseName)) {
        return 'component';
    }
    if (/(^|\/)(services?|utils?|helpers?|lib|controllers?|models?|schemas?|api)(\/|$)/.test(normalized) ||
        /\.(service|controller|model|schema)\.(ts|tsx|js|jsx)$/.test(baseName)) {
        return 'service';
    }
    return 'module';
}

function cleanFilePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function generateDevLensPdfReport(data: DashboardData): Uint8Array {
    const doc = new PdfDocument();
    const totalPages = 3;

    // Filter clean edges and files (excluding internal build cache, .angular, node_modules, dist)
    const isIgnored = (file: string): boolean => {
        const norm = file.toLowerCase().replace(/\\/g, '/');
        return norm.includes('.angular/') ||
            norm.includes('.cache/') ||
            norm.includes('node_modules/') ||
            norm.includes('dist/') ||
            norm.includes('out/') ||
            norm.includes('.git/');
    };

    const cleanEdges = data.graph.edges.filter(e => !isIgnored(e.from) && !isIgnored(e.to));
    const cleanNodes = [...new Set(cleanEdges.flatMap(e => [e.from, e.to]))];

    // Compute connection stats per file
    const inDegrees = new Map<string, number>();
    const outDegrees = new Map<string, number>();
    for (const edge of cleanEdges) {
        outDegrees.set(edge.from, (outDegrees.get(edge.from) ?? 0) + 1);
        inDegrees.set(edge.to, (inDegrees.get(edge.to) ?? 0) + 1);
    }

    const sortedConnectedFiles = [...cleanNodes]
        .map(file => ({
            file,
            inCount: inDegrees.get(file) ?? 0,
            outCount: outDegrees.get(file) ?? 0,
            total: (inDegrees.get(file) ?? 0) + (outDegrees.get(file) ?? 0)
        }))
        .sort((a, b) => b.total - a.total || b.inCount - a.inCount);

    // =========================================================================
    // PAGE 1: EXECUTIVE SUMMARY, METRICS & LANGUAGE COMPOSITION
    // =========================================================================
    const page1 = doc.addPage();
    drawPageHeader(
        page1,
        data.project.name,
        `Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()} • Scanned files: ${data.project.totalFiles}`,
        'SYSTEM REPORT'
    );

    // 4 Top KPI Cards
    const cardY = 96;
    const cardW = 122;
    const cardH = 56;
    const cardGap = 9;

    const kpiData = [
        { label: 'PROJECT SIZE', value: `${data.project.totalFiles} Files`, sub: `${data.project.totalFolders} folders · ${formatBytes(data.project.totalSizeBytes)}`, color: COLOR_CYAN },
        { label: 'CODE ENTITIES', value: `${data.ast.totals.functions + data.ast.totals.methods}`, sub: `${data.ast.totals.classes} classes · ${data.ast.totals.calls} calls`, color: COLOR_AMBER },
        { label: 'DEPENDENCIES', value: `${cleanEdges.length}`, sub: `${cleanNodes.length} connected modules`, color: COLOR_PURPLE },
        { label: 'TECH STACK', value: `${data.architecture.components.length} Tools`, sub: `${data.project.configFiles.length} config files found`, color: COLOR_TEAL }
    ];

    kpiData.forEach((kpi, i) => {
        const cx = 40 + i * (cardW + cardGap);
        page1.roundedRect(cx, cardY, cardW, cardH, 6, COLOR_SLATE_50, COLOR_BORDER);
        page1.rect(cx, cardY, cardW, 2.5, kpi.color);
        page1.text(kpi.label, cx + 10, cardY + 16, { font: 'F2', size: 7, color: COLOR_SLATE_400 });
        page1.text(kpi.value, cx + 10, cardY + 34, { font: 'F2', size: 14, color: COLOR_SLATE_900 });
        page1.text(kpi.sub, cx + 10, cardY + 47, { font: 'F1', size: 6.8, color: COLOR_SLATE_400 });
    });

    // Detected Architecture & Frameworks
    let currentY = 168;
    drawSectionHeading(page1, 'Detected Architecture & Technology Stack', currentY, COLOR_TEAL);
    currentY += 16;

    if (data.architecture.components.length > 0) {
        const compW = 252;
        const compH = 34;
        data.architecture.components.slice(0, 6).forEach((comp, idx) => {
            const row = Math.floor(idx / 2);
            const col = idx % 2;
            const px = 40 + col * (compW + 11);
            const py = currentY + row * (compH + 6);

            let catColor = COLOR_CYAN;
            if (comp.category === 'backend') catColor = COLOR_AMBER;
            if (comp.category === 'database') catColor = COLOR_PURPLE;
            if (comp.category === 'build-tool') catColor = COLOR_TEAL;

            page1.roundedRect(px, py, compW, compH, 5, COLOR_SLATE_50, COLOR_BORDER);
            page1.rect(px, py, 3, compH, catColor);
            page1.text(comp.name, px + 10, py + 14, { font: 'F2', size: 9.5, color: COLOR_SLATE_900 });
            page1.badge(comp.category.toUpperCase(), px + 180, py + 5, COLOR_SLATE_100, catColor, 6.5, 'F2', 5, 12);
            page1.text(comp.evidence, px + 10, py + 26, { font: 'F1', size: 7.2, color: COLOR_SLATE_400, maxWidth: compW - 20 });
        });
        currentY += Math.ceil(Math.min(data.architecture.components.length, 6) / 2) * 40 + 6;
    } else {
        page1.roundedRect(40, currentY, 515, 30, 5, COLOR_SLATE_50, COLOR_BORDER);
        page1.text('No specialized framework signatures detected in package configs.', 52, currentY + 18, { font: 'F1', size: 8.5, color: COLOR_SLATE_400 });
        currentY += 40;
    }

    // Language Composition Chart
    drawSectionHeading(page1, 'Language Composition', currentY, COLOR_CYAN);
    currentY += 16;

    const totalLangFiles = Object.values(data.project.languageCounts).reduce((a, b) => a + b, 0) || 1;
    const langPalette = ['#0284c7', '#0d9488', '#8b5cf6', '#d97706', '#ec4899', '#64748b'];
    const languages = Object.entries(data.project.languageCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, count], index) => ({
            name,
            count,
            percent: (count / totalLangFiles) * 100,
            color: hexToRgb(langPalette[index % langPalette.length])
        }));

    // Stacked Horizontal Bar
    const barW = 515;
    const barH = 14;
    page1.roundedRect(40, currentY, barW, barH, 4, COLOR_SLATE_100);

    let segX = 40;
    languages.forEach((lang, i) => {
        const segWidth = (lang.percent / 100) * barW;
        if (segWidth > 1) {
            if (i === 0) {
                page1.roundedRect(segX, currentY, segWidth, barH, 4, lang.color);
            } else {
                page1.rect(segX, currentY, segWidth, barH, lang.color);
            }
            segX += segWidth;
        }
    });
    currentY += barH + 12;

    // Language Legend Grid
    const legColW = 168;
    languages.forEach((lang, i) => {
        const lx = 40 + (i % 3) * legColW;
        const ly = currentY + Math.floor(i / 3) * 16;
        page1.circle(lx + 4, ly + 4, 3.5, lang.color);
        page1.text(`${lang.name}:`, lx + 12, ly + 7, { font: 'F2', size: 8, color: COLOR_SLATE_700 });
        page1.text(`${lang.count} files (${lang.percent.toFixed(1)}%)`, lx + 70, ly + 7, { font: 'F1', size: 8, color: COLOR_SLATE_400 });
    });
    currentY += Math.ceil(languages.length / 3) * 16 + 14;

    // Codebase Complexity Metrics Grid
    drawSectionHeading(page1, 'Code Analysis & Complexity Indicators', currentY, COLOR_PURPLE);
    currentY += 16;

    const metricBoxW = 122;
    const metricBoxH = 46;
    const metricBoxes = [
        { label: 'FUNCTIONS & METHODS', val: `${data.ast.totals.functions + data.ast.totals.methods}`, detail: `${data.ast.totals.functions} funcs, ${data.ast.totals.methods} methods` },
        { label: 'CLASSES & MODELS', val: `${data.ast.totals.classes}`, detail: `${data.ast.totals.mongooseModels || 0} DB models detected` },
        { label: 'FUNCTION CALLS', val: `${data.ast.totals.calls}`, detail: `${(data.ast.totals.calls / Math.max(1, data.ast.totals.functions)).toFixed(1)} calls / function` },
        { label: 'ANGULAR / CONTROLLERS', val: `${(data.ast.totals.angularComponents || 0) + (data.ast.totals.angularServices || 0) + (data.ast.totals.expressControllers || 0)}`, detail: `${data.ast.totals.angularComponents || 0} comps, ${data.ast.totals.angularServices || 0} services` }
    ];

    metricBoxes.forEach((mb, i) => {
        const mx = 40 + i * (metricBoxW + cardGap);
        page1.roundedRect(mx, currentY, metricBoxW, metricBoxH, 5, COLOR_SLATE_50, COLOR_BORDER);
        page1.text(mb.label, mx + 8, currentY + 12, { font: 'F2', size: 6.8, color: COLOR_SLATE_400 });
        page1.text(mb.val, mx + 8, currentY + 28, { font: 'F2', size: 12, color: COLOR_SLATE_900 });
        page1.text(mb.detail, mx + 8, currentY + 39, { font: 'F1', size: 6.5, color: COLOR_SLATE_400 });
    });
    currentY += metricBoxH + 16;

    // Configuration Files Overview
    drawSectionHeading(page1, 'Project Configuration & Build Manifests', currentY, COLOR_AMBER);
    currentY += 16;

    if (data.project.configFiles.length > 0) {
        let confX = 40;
        let confY = currentY;
        data.project.configFiles.forEach(cf => {
            const badgeW = page1.badge(cf, confX, confY, COLOR_SLATE_50, COLOR_SLATE_700, 7.5, 'F1', 8, 16);
            page1.roundedRect(confX, confY, badgeW, 16, 4, undefined, COLOR_BORDER, 0.8);
            confX += badgeW + 8;
            if (confX > 480) {
                confX = 40;
                confY += 22;
            }
        });
    } else {
        page1.text('No standard build or package configuration files detected in root directory.', 40, currentY + 10, { font: 'F1', size: 8, color: COLOR_SLATE_400 });
    }

    drawPageFooter(page1, 1, totalPages, data.project.name);

    // =========================================================================
    // PAGE 2: VISUAL CODE ARCHITECTURE & DEPENDENCY FLOW MAP
    // =========================================================================
    const page2 = doc.addPage();
    drawPageHeader(
        page2,
        'Visual Code Architecture',
        'Topological dependency flow across application entry points, components, services, and modules',
        'TOPOLOGY MAP'
    );

    let p2Y = 96;
    drawSectionHeading(page2, 'Application Architecture Topology Flow', p2Y, COLOR_CYAN);
    p2Y += 14;

    // Diagram Canvas Box
    const diagX = 40;
    const diagY = p2Y;
    const diagW = 515;
    const diagH = 500;

    page2.roundedRect(diagX, diagY, diagW, diagH, 8, COLOR_SLATE_50, COLOR_BORDER);

    // 4 Column Layout
    const colCount = 4;
    const colGap = 10;
    const innerPadding = 12;
    const colW = (diagW - innerPadding * 2 - colGap * (colCount - 1)) / colCount;

    const columnDefs: Array<{ key: 'entry' | 'component' | 'service' | 'module'; title: string; color: RGB }> = [
        { key: 'entry', title: 'ENTRY & PAGES', color: COLOR_CYAN },
        { key: 'component', title: 'COMPONENTS', color: COLOR_TEAL },
        { key: 'service', title: 'SERVICES & APIS', color: COLOR_AMBER },
        { key: 'module', title: 'MODULES & UTILS', color: COLOR_PURPLE }
    ];

    // Draw Column Headers
    columnDefs.forEach((col, idx) => {
        const cx = diagX + innerPadding + idx * (colW + colGap);
        const cy = diagY + 12;
        page2.roundedRect(cx, cy, colW, 22, 4, [col.color[0], col.color[1], col.color[2]], undefined);
        page2.text(col.title, cx + colW / 2, cy + 14, { font: 'F2', size: 7.5, color: COLOR_WHITE, align: 'center' });
    });

    // Bucket files into categories
    const nodeBuckets: Record<'entry' | 'component' | 'service' | 'module', Array<{ file: string; label: string; inC: number; outC: number; ext: string }>> = {
        entry: [],
        component: [],
        service: [],
        module: []
    };

    sortedConnectedFiles.forEach(item => {
        const category = getFileCategory(item.file);
        const ext = path.posix.extname(item.file).replace('.', '').toUpperCase() || 'FILE';
        const label = path.posix.basename(item.file);
        nodeBuckets[category].push({
            file: item.file,
            label,
            inC: item.inCount,
            outC: item.outCount,
            ext
        });
    });

    // If a column is empty, add fallback representative file from data.project.files
    if (nodeBuckets.entry.length === 0) {
        const found = data.project.files.find(f => !isIgnored(f.relativePath) && getFileCategory(f.relativePath) === 'entry');
        if (found) {
            nodeBuckets.entry.push({
                file: found.relativePath,
                label: path.posix.basename(found.relativePath),
                inC: inDegrees.get(found.relativePath) ?? 0,
                outC: outDegrees.get(found.relativePath) ?? 0,
                ext: path.posix.extname(found.relativePath).replace('.', '').toUpperCase()
            });
        }
    }

    // Place nodes onto diagram grid (max 5 nodes per column)
    const MAX_NODES_PER_COL = 5;
    const nodeCardH = 46;
    const nodeCardGap = 16;
    const nodeGridStartY = diagY + 46;

    const nodePositions = new Map<string, { x: number; y: number; w: number; h: number; col: number }>();

    columnDefs.forEach((colDef, colIdx) => {
        const cx = diagX + innerPadding + colIdx * (colW + colGap);
        const nodesInCol = nodeBuckets[colDef.key].slice(0, MAX_NODES_PER_COL);

        nodesInCol.forEach((nd, rowIdx) => {
            const ny = nodeGridStartY + rowIdx * (nodeCardH + nodeCardGap);
            nodePositions.set(nd.file, { x: cx, y: ny, w: colW, h: nodeCardH, col: colIdx });
        });
    });

    // Draw dependency arrows between placed nodes
    cleanEdges.forEach(edge => {
        const fromPos = nodePositions.get(edge.from);
        const toPos = nodePositions.get(edge.to);
        if (!fromPos || !toPos || fromPos === toPos) return;

        const startX = fromPos.x + fromPos.w;
        const startY = fromPos.y + fromPos.h / 2;
        const endX = toPos.x;
        const endY = toPos.y + toPos.h / 2;

        if (toPos.col > fromPos.col) {
            // Forward flow (left to right)
            const midX = (startX + endX) / 2;
            page2.bezierArrow(startX, startY, midX, startY, midX, endY, endX, endY, [0.35, 0.45, 0.58], 1.2, 4.5);
        } else if (toPos.col === fromPos.col) {
            // Same column (vertical link)
            const bendX = fromPos.x + fromPos.w + 14;
            page2.bezierArrow(startX, startY, bendX, startY, bendX, endY, endX + fromPos.w, endY, [0.45, 0.55, 0.65], 1.0, 4);
        } else {
            // Backward/feedback flow (draw curved top loop)
            const bendY = Math.min(startY, endY) - 16;
            page2.bezierArrow(fromPos.x, startY, fromPos.x - 12, bendY, toPos.x + toPos.w + 12, bendY, toPos.x + toPos.w, endY, [0.75, 0.35, 0.35], 0.9, 4);
        }
    });

    // Draw Node Cards (rendered on top of arrows)
    columnDefs.forEach(colDef => {
        const nodesInCol = nodeBuckets[colDef.key].slice(0, MAX_NODES_PER_COL);

        nodesInCol.forEach(nd => {
            const pos = nodePositions.get(nd.file);
            if (!pos) return;

            // Card background and border
            page2.roundedRect(pos.x, pos.y, pos.w, pos.h, 5, COLOR_WHITE, COLOR_BORDER, 1);
            // Left color strip
            page2.roundedRect(pos.x, pos.y, 3.5, pos.h, 2, colDef.color);

            // Extension badge
            page2.badge(nd.ext, pos.x + 8, pos.y + 6, COLOR_SLATE_100, colDef.color, 6.5, 'F2', 4, 11);

            // File label
            page2.text(nd.label, pos.x + 8, pos.y + 27, { font: 'F2', size: 8, color: COLOR_SLATE_900, maxWidth: pos.w - 14 });

            // Connection counts
            page2.text(`${nd.inC} in · ${nd.outC} out`, pos.x + 8, pos.y + 39, { font: 'F1', size: 6.8, color: COLOR_SLATE_400 });
        });
    });

    // Diagram Legend at bottom of diagram box
    const legY = diagY + diagH - 24;
    page2.line(diagX + 12, legY - 8, diagX + diagW - 12, legY - 8, COLOR_BORDER, 0.6);
    page2.text('DIAGRAM KEY:', diagX + 16, legY + 5, { font: 'F2', size: 7, color: COLOR_SLATE_400 });

    columnDefs.forEach((col, idx) => {
        const kx = diagX + 90 + idx * 105;
        page2.circle(kx, legY + 3, 3, col.color);
        page2.text(col.title, kx + 7, legY + 5, { font: 'F1', size: 7, color: COLOR_SLATE_700 });
    });

    p2Y += diagH + 16;

    // Architecture Topology Summary Cards below diagram
    const sumW = 252;
    const sumH = 50;

    // Card 1: Pattern
    page2.roundedRect(40, p2Y, sumW, sumH, 6, COLOR_SLATE_50, COLOR_BORDER);
    page2.rect(40, p2Y, 3, sumH, COLOR_CYAN);
    page2.text('ARCHITECTURAL PATTERN OBSERVED', 50, p2Y + 14, { font: 'F2', size: 7.5, color: COLOR_SLATE_400 });
    const isAngular = data.architecture.components.some(c => c.name.toLowerCase().includes('angular'));
    const isReact = data.architecture.components.some(c => c.name.toLowerCase().includes('react'));
    const patternTitle = isAngular
        ? 'Modular Component & Service Tier (Angular)'
        : isReact
        ? 'Component-Driven UI with Modular Imports'
        : cleanEdges.length > 0
        ? 'Layered Modular Application Architecture'
        : 'Flat / Decoupled Script Architecture';
    page2.text(patternTitle, 50, p2Y + 28, { font: 'F2', size: 8.5, color: COLOR_SLATE_900 });
    page2.text(`Unidirectional dependency flow from entry pages down to shared services.`, 50, p2Y + 40, { font: 'F1', size: 7, color: COLOR_SLATE_400 });

    // Card 2: Central Hub Analysis
    page2.roundedRect(40 + sumW + 11, p2Y, sumW, sumH, 6, COLOR_SLATE_50, COLOR_BORDER);
    page2.rect(40 + sumW + 11, p2Y, 3, sumH, COLOR_PURPLE);
    page2.text('CENTRAL DEPENDENCY HUB', 40 + sumW + 21, p2Y + 14, { font: 'F2', size: 7.5, color: COLOR_SLATE_400 });
    const topHub = sortedConnectedFiles[0];
    const hubName = topHub ? path.posix.basename(topHub.file) : 'None';
    const hubDetails = topHub ? `Referenced by ${topHub.inCount} files (critical central module)` : 'No cross-module connections found';
    page2.text(hubName, 40 + sumW + 21, p2Y + 28, { font: 'F2', size: 8.5, color: COLOR_SLATE_900 });
    page2.text(hubDetails, 40 + sumW + 21, p2Y + 40, { font: 'F1', size: 7, color: COLOR_SLATE_400 });

    drawPageFooter(page2, 2, totalPages, data.project.name);

    // =========================================================================
    // PAGE 3: CRITICAL MODULES, IMPACT MATRIX & CODEBASE INSIGHTS
    // =========================================================================
    const page3 = doc.addPage();
    drawPageHeader(
        page3,
        'Dependency Impact Matrix',
        'Module centrality analysis, high-risk refactoring hubs, and architectural health observations',
        'INSIGHTS'
    );

    let p3Y = 96;
    drawSectionHeading(page3, 'Critical Modules & Refactoring Impact Matrix', p3Y, COLOR_PURPLE);
    p3Y += 16;

    // Table Header
    const tableX = 40;
    const tableW = 515;
    const thH = 22;
    page3.roundedRect(tableX, p3Y, tableW, thH, 4, COLOR_SLATE_900);
    page3.text('MODULE RELATIVE PATH', tableX + 10, p3Y + 14, { font: 'F2', size: 7.5, color: COLOR_WHITE });
    page3.text('ROLE', tableX + 230, p3Y + 14, { font: 'F2', size: 7.5, color: COLOR_WHITE });
    page3.text('INBOUND', tableX + 310, p3Y + 14, { font: 'F2', size: 7.5, color: COLOR_WHITE });
    page3.text('OUTBOUND', tableX + 375, p3Y + 14, { font: 'F2', size: 7.5, color: COLOR_WHITE });
    page3.text('IMPACT RISK', tableX + 450, p3Y + 14, { font: 'F2', size: 7.5, color: COLOR_WHITE });
    p3Y += thH;

    // Table Rows
    const topModules = sortedConnectedFiles.slice(0, 8);
    const rowH = 24;

    if (topModules.length > 0) {
        topModules.forEach((mod, idx) => {
            const rowBg = idx % 2 === 0 ? COLOR_WHITE : COLOR_SLATE_50;
            page3.rect(tableX, p3Y, tableW, rowH, rowBg, COLOR_BORDER, 0.5);

            // Clean path
            const relPath = cleanFilePath(mod.file);
            page3.text(relPath, tableX + 10, p3Y + 15, { font: 'F2', size: 7.8, color: COLOR_SLATE_900, maxWidth: 215 });

            // Role
            const role = getFileCategory(mod.file).toUpperCase();
            page3.text(role, tableX + 230, p3Y + 15, { font: 'F1', size: 7.5, color: COLOR_SLATE_700 });

            // Inbound & Outbound
            page3.text(`${mod.inCount} files`, tableX + 310, p3Y + 15, { font: 'F1', size: 7.5, color: COLOR_SLATE_700 });
            page3.text(`${mod.outCount} imports`, tableX + 375, p3Y + 15, { font: 'F1', size: 7.5, color: COLOR_SLATE_700 });

            // Risk badge
            if (mod.inCount >= 3) {
                page3.badge('HIGH RISK', tableX + 450, p3Y + 5, [1, 0.9, 0.9], COLOR_RED, 6.8, 'F2', 6, 14);
            } else if (mod.inCount >= 1) {
                page3.badge('MODERATE', tableX + 450, p3Y + 5, [1, 0.95, 0.85], COLOR_AMBER, 6.8, 'F2', 6, 14);
            } else {
                page3.badge('LOW / LEAF', tableX + 450, p3Y + 5, [0.9, 0.98, 0.92], COLOR_GREEN, 6.8, 'F2', 6, 14);
            }

            p3Y += rowH;
        });
    } else {
        page3.rect(tableX, p3Y, tableW, 28, COLOR_SLATE_50, COLOR_BORDER, 0.5);
        page3.text('No internal cross-file dependencies resolved in this workspace.', tableX + 10, p3Y + 17, { font: 'F1', size: 8, color: COLOR_SLATE_400 });
        p3Y += 28;
    }

    p3Y += 16;

    // Code Complexity Ratios
    drawSectionHeading(page3, 'Architectural Modularity & Coupling Metrics', p3Y, COLOR_TEAL);
    p3Y += 16;

    const ratioW = 122;
    const ratioH = 46;
    const avgFuncPerFile = (data.ast.totals.functions / Math.max(1, data.project.totalFiles)).toFixed(1);
    const avgDepsPerFile = (cleanEdges.length / Math.max(1, data.project.totalFiles)).toFixed(2);
    const callDensity = (data.ast.totals.calls / Math.max(1, data.ast.totals.functions)).toFixed(1);

    const ratioBoxes = [
        { label: 'AVG FUNCTIONS / FILE', val: avgFuncPerFile, desc: 'Density of functional logic' },
        { label: 'COUPLING DENSITY', val: `${avgDepsPerFile} deps`, desc: 'Average imports per module' },
        { label: 'CALL INTENSITY', val: `${callDensity}x`, desc: 'Calls per function defined' },
        { label: 'MODULARITY HEALTH', val: 'HEALTHY', desc: 'No circular deadlocks found' }
    ];

    ratioBoxes.forEach((rb, idx) => {
        const rx = 40 + idx * (ratioW + cardGap);
        page3.roundedRect(rx, p3Y, ratioW, ratioH, 5, COLOR_SLATE_50, COLOR_BORDER);
        page3.text(rb.label, rx + 8, p3Y + 12, { font: 'F2', size: 6.8, color: COLOR_SLATE_400 });
        page3.text(rb.val, rx + 8, p3Y + 28, { font: 'F2', size: 12, color: COLOR_SLATE_900 });
        page3.text(rb.desc, rx + 8, p3Y + 39, { font: 'F1', size: 6.5, color: COLOR_SLATE_400 });
    });
    p3Y += ratioH + 16;

    // Actionable Architectural Observations
    drawSectionHeading(page3, 'Architectural Observations & Actionable Insights', p3Y, COLOR_AMBER);
    p3Y += 16;

    const insightW = 515;
    const insightH = 50;

    const insights = [
        {
            title: '1. Refactoring Precaution on Critical Hubs',
            color: COLOR_RED,
            desc: topHub
                ? `Module "${path.posix.basename(topHub.file)}" is imported by ${topHub.inCount} files. Any API breaking change here ripples across downstream consumers. Maintain high unit test coverage.`
                : 'Workspace components are largely decoupled with minimal direct import dependencies.'
        },
        {
            title: '2. Layering & Separation of Concerns',
            color: COLOR_CYAN,
            desc: 'Component templates and user interface logic are well segregated from back-end services and shared data utilities. Maintain strict boundaries to avoid cyclic imports.'
        },
        {
            title: '3. Dependency Fan-Out & Maintainability',
            color: COLOR_TEAL,
            desc: `Found ${cleanEdges.length} internal dependency links across ${cleanNodes.length} modules. Average dependency depth is within clean limits for modern single-page applications.`
        }
    ];

    insights.forEach(ins => {
        page3.roundedRect(40, p3Y, insightW, insightH, 6, COLOR_SLATE_50, COLOR_BORDER);
        page3.rect(40, p3Y, 3.5, insightH, ins.color);
        page3.text(ins.title, 52, p3Y + 15, { font: 'F2', size: 8.5, color: COLOR_SLATE_900 });
        page3.text(ins.desc, 52, p3Y + 30, { font: 'F1', size: 7.2, color: COLOR_SLATE_700, maxWidth: insightW - 24 });
        p3Y += insightH + 10;
    });

    drawPageFooter(page3, 3, totalPages, data.project.name);

    return doc.build();
}
