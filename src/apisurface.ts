import ts from 'ts-api';
import path from 'node:path';

export interface MemberInfo {
  t: string; // tipo / firma
  dep?: string; // mensaje @deprecated ('' si no tiene mensaje)
}
export interface ExportInfo {
  kind: string;
  sig: string;
  dep?: string;
  members?: Record<string, MemberInfo>;
}
/** Superficie pública por módulo: "." es el import principal; "./headers" sería `import ... from "pkg/headers"`. */
export interface Surface {
  modules: Record<string, Record<string, ExportInfo>>;
  truncated: boolean;
}

const ROOT = '/pkg/';
const MAX_MODULES = 40;
const MAX_EXPORTS = 1500;
const MAX_MEMBERS = 300;
const MAX_SIG = 600;
const clip = (s: string, n = MAX_SIG) => (s.length > n ? `${s.slice(0, n)}…` : s);
/** Quita rutas internas del análisis: import("/pkg/dist/x").Foo → Foo */
const clean = (s: string) => s.replace(/import\("\/pkg\/[^"]*"\)\./g, '');

const DTS = /\.d\.(m|c)?ts$/;

function readPkg(files: Map<string, string>): any {
  try {
    return JSON.parse(files.get('package.json') ?? '{}');
  } catch {
    return {};
  }
}

/** Busca un archivo de tipos existente a partir de una ruta declarada en package.json. */
function findDts(files: Map<string, string>, p: unknown): string | null {
  if (typeof p !== 'string') return null;
  const c = p.replace(/^\.\//, '');
  const variants = [c, c.replace(/\.(c|m)?js$/, '.d.$1ts'), `${c.replace(/\.(c|m)?js$/, '')}.d.ts`, `${c.replace(/\/$/, '')}/index.d.ts`];
  for (const v of variants) if (files.has(v) && DTS.test(v)) return v;
  return null;
}

function typesOfCondition(o: unknown): string | null {
  if (typeof o === 'string') return DTS.test(o) ? o : null;
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  if (typeof r.types === 'string') return r.types;
  for (const k of ['import', 'require', 'node', 'default']) {
    const v = typesOfCondition(r[k]);
    if (v) return v;
  }
  return null;
}

/**
 * Módulos públicos y su archivo de tipos:
 * - "." desde types/typings/exports["."]/main/index.d.ts
 * - subrutas del mapa "exports" (./headers, ./server…), o si no hay mapa, los .d.ts de la raíz (estilo next/headers).
 */
export function typesEntries(files: Map<string, string>): Array<[string, string]> {
  const pkg = readPkg(files);
  const out = new Map<string, string>();
  const exportsMap = pkg.exports && typeof pkg.exports === 'object' && !Array.isArray(pkg.exports) && Object.keys(pkg.exports).some((k) => k.startsWith('.')) ? pkg.exports : null;

  const main =
    findDts(files, pkg.types) ??
    findDts(files, pkg.typings) ??
    findDts(files, typesOfCondition(exportsMap?.['.'] ?? (exportsMap ? null : pkg.exports))) ??
    findDts(files, pkg.main) ??
    ['index.d.ts', 'index.d.mts', 'index.d.cts', 'dist/index.d.ts', 'lib/index.d.ts', 'types/index.d.ts'].find((f) => files.has(f)) ??
    null;
  if (main) out.set('.', main);

  if (exportsMap) {
    for (const [key, val] of Object.entries(exportsMap)) {
      if (key === '.' || key.includes('*') || key.endsWith('package.json') || out.size >= MAX_MODULES) continue;
      const f = findDts(files, typesOfCondition(val));
      if (f) out.set(key, f);
    }
  } else {
    for (const f of [...files.keys()].sort()) {
      if (out.size >= MAX_MODULES) break;
      if (f.includes('/') || !f.endsWith('.d.ts') || f === main || /^(index|global|globals|types?)\.d\.ts$/.test(f) || f.startsWith('_')) continue;
      out.set(`./${f.replace(/\.d\.ts$/, '')}`, f);
    }
  }
  return [...out.entries()];
}

/** Compatibilidad hacia atrás para quien sólo necesita la entrada principal. */
export function typesEntry(files: Map<string, string>): string | null {
  return typesEntries(files).find(([k]) => k === '.')?.[1] ?? null;
}

function deprecatedOf(decls: readonly ts.Declaration[] | undefined): string | undefined {
  for (const d of decls ?? []) {
    for (const tag of ts.getJSDocTags(d)) {
      if (tag.tagName.text === 'deprecated') return clip(ts.getTextOfJSDocComment(tag.comment) ?? '', 300);
    }
  }
  return undefined;
}

function kindOf(sym: ts.Symbol): string {
  const f = sym.flags;
  if (f & ts.SymbolFlags.Class) return 'class';
  if (f & ts.SymbolFlags.Interface) return 'interface';
  if (f & ts.SymbolFlags.Enum) return 'enum';
  if (f & ts.SymbolFlags.TypeAlias) return 'type';
  if (f & ts.SymbolFlags.Function) return 'function';
  if (f & (ts.SymbolFlags.Variable | ts.SymbolFlags.Property)) return 'variable';
  if (f & ts.SymbolFlags.Module) return 'namespace';
  return 'other';
}

function createHost(files: Map<string, string>, options: ts.CompilerOptions): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  // Las librerías estándar de TypeScript (lib.*.d.ts) se leen del disco; el paquete analizado vive en memoria bajo /pkg/.
  const libDirectory = path.dirname(ts.getDefaultLibFilePath(options)).replace(/\\/g, '/');
  const isLib = (p: string) => p.replace(/\\/g, '/').startsWith(libDirectory);
  const virt = (p: string) => (p.startsWith(ROOT) ? files.get(p.slice(ROOT.length)) : undefined);
  const baseGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, lang) => {
    const text = virt(fileName);
    if (text !== undefined) return ts.createSourceFile(fileName, text, lang, true);
    return isLib(fileName) ? baseGetSourceFile(fileName, lang) : undefined;
  };
  host.fileExists = (p) => (p.startsWith(ROOT) ? files.has(p.slice(ROOT.length)) : isLib(p) && ts.sys.fileExists(p));
  host.readFile = (p) => virt(p) ?? (isLib(p) ? ts.sys.readFile(p) : undefined);
  // Ojo: TypeScript pregunta por "/pkg" sin barra final; si respondemos false, aborta la resolución de módulos.
  const dirs = new Set<string>(['/pkg']);
  for (const k of files.keys()) {
    const parts = k.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(`/pkg/${parts.slice(0, i).join('/')}`);
  }
  host.directoryExists = (d) => {
    const n = d.replace(/\/$/, '');
    return n === '/pkg' || n.startsWith('/pkg/') ? dirs.has(n) : isLib(d) && (ts.sys.directoryExists?.(d) ?? false);
  };
  host.getCurrentDirectory = () => ROOT;
  // Rutas exactas: en Windows el host por defecto pasa todo a minúsculas y "lib/ZodError.d.ts" deja de encontrarse.
  host.useCaseSensitiveFileNames = () => true;
  host.getCanonicalFileName = (f) => f;
  host.realpath = (p) => p;
  return host;
}

/** Analiza la superficie pública exportada por cada módulo. Sólo lee texto de declaraciones; no ejecuta nada. */
export function analyzeSurface(files: Map<string, string>, entries: Array<[string, string]>): Surface {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    strict: true,
  };
  const program = ts.createProgram({ rootNames: entries.map(([, f]) => `${ROOT}${f}`), options, host: createHost(files, options) });
  const checker = program.getTypeChecker();
  const flags = ts.TypeFormatFlags.NoTruncation;
  const typeStr = (t: ts.Type, alias = false) => clean(checker.typeToString(t, undefined, alias ? flags | ts.TypeFormatFlags.InTypeAlias : flags));
  const sigStr = (s: readonly ts.Signature[]) => clean(s.map((x) => checker.signatureToString(x, undefined, flags)).join(' | '));
  const modules: Record<string, Record<string, ExportInfo>> = {};
  let truncated = entries.length >= MAX_MODULES;

  for (const [mod, file] of entries) {
    const sf = program.getSourceFile(`${ROOT}${file}`);
    const moduleSymbol = sf ? checker.getSymbolAtLocation(sf) : undefined;
    if (!moduleSymbol) continue;
    const out: Record<string, ExportInfo> = {};
    const exportsList = checker.getExportsOfModule(moduleSymbol);
    if (exportsList.length > MAX_EXPORTS) truncated = true;
    for (const exp of exportsList.slice(0, MAX_EXPORTS)) {
      const sym = exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
      const decl = sym.declarations?.[0] ?? exp.declarations?.[0];
      const kind = kindOf(sym);
      let sig = '';
      let members: Record<string, MemberInfo> | undefined;
      try {
        if (kind === 'function' || kind === 'variable') {
          const type = decl ? checker.getTypeOfSymbolAtLocation(sym, decl) : checker.getDeclaredTypeOfSymbol(sym);
          const calls = type.getCallSignatures();
          sig = calls.length ? sigStr(calls) : typeStr(type);
        } else if (kind === 'type' || kind === 'enum') {
          sig = typeStr(checker.getDeclaredTypeOfSymbol(sym), true);
        } else if (kind === 'class' || kind === 'interface') {
          sig = kind;
          members = {};
          const instance = checker.getDeclaredTypeOfSymbol(sym);
          const all: Array<[string, ts.Symbol]> = checker.getPropertiesOfType(instance).map((p) => [p.name, p]);
          if (kind === 'class' && decl) {
            const ctorType = checker.getTypeOfSymbolAtLocation(sym, decl);
            const ctors = ctorType.getConstructSignatures();
            if (ctors.length) members['constructor'] = { t: clip(sigStr(ctors), 300) };
            for (const p of checker.getPropertiesOfType(ctorType)) if (p.name !== 'prototype') all.push([`static ${p.name}`, p]);
          }
          if (all.length > MAX_MEMBERS) truncated = true;
          for (const [mName, m] of all.slice(0, MAX_MEMBERS)) {
            if (mName.startsWith('#') || mName.startsWith('__')) continue;
            const md = m.valueDeclaration ?? m.declarations?.[0];
            const mt = md ? checker.getTypeOfSymbolAtLocation(m, md) : checker.getDeclaredTypeOfSymbol(m);
            const calls = mt.getCallSignatures();
            const dep = deprecatedOf(m.declarations);
            const t = clip(calls.length ? sigStr(calls) : typeStr(mt), 300);
            members[mName] = dep !== undefined ? { t, dep } : { t };
          }
        } else if (kind === 'namespace') {
          sig = 'namespace';
        }
      } catch {
        sig = sig || '?';
      }
      const info: ExportInfo = { kind, sig: clip(sig) };
      const dep = deprecatedOf(sym.declarations);
      if (dep !== undefined) info.dep = dep;
      if (members) info.members = members;
      out[exp.name] = info;
    }
    modules[mod] = out;
  }
  return { modules, truncated };
}
