#!/usr/bin/env node
// Inventory of the KNIME, Eclipse and third-party APIs the bridge bundle uses.
// Compiles the bundle sources against an installed KNIME, reads the constant pools with
// javap and maps every referenced class to the bundle that exports its package.
// Reflective access is invisible to javap, so it is listed from source.
//
// Usage: node scripts/api-surface.mjs [--knime <eclipse home>] [--json <file>] [--markdown <file>]
// Needs a JDK (JAVA_HOME, KNIME_AGENT_JDK or javac on PATH) and `tar` (macOS and Windows 10+ ship bsdtar).
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {root, bundleSources, bundleManifest, requireKnimeHome, javaTool, walk, knimeClasspath, javac} from './lib/java-toolchain.mjs';

const OWN_PREFIX = 'org/knime/agent/';
// org.w3c.dom and org.xml.sax come from the JDK; some Eclipse bundles re-export them.
const JDK_PREFIXES = ['java/', 'javax/', 'jdk/', 'sun/', 'com/sun/proxy/', 'org/w3c/dom/', 'org/xml/sax/'];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true, ...options});
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}: ${(result.stderr || result.stdout).slice(0, 4000)}`);
  return result.stdout;
}

// Manifest header values may continue on lines that start with one space.
export function manifestHeaders(text) {
  const headers = {};
  let key = null;
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (line.startsWith(' ') && key) { headers[key] += line.slice(1); continue; }
    const match = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
    if (match) { key = match[1]; headers[key] = match[2]; } else key = null;
  }
  return headers;
}

// Split on commas that are not inside double quotes, then keep the package name
// and the x-internal / x-friends markers.
export function exportedPackages(value = '') {
  const clauses = [];
  let current = '', quoted = false;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    if (ch === ',' && !quoted) { clauses.push(current); current = ''; } else current += ch;
  }
  if (current.trim()) clauses.push(current);
  return clauses.map(clause => {
    const [name, ...attributes] = clause.split(';').map(s => s.trim());
    const text = attributes.join(';');
    return {name, internal: /x-internal:=true/.test(text), friends: /x-friends:=/.test(text)};
  }).filter(p => p.name);
}

async function readManifest(plugin) {
  const stat = await fs.stat(plugin);
  if (stat.isDirectory()) {
    const file = path.join(plugin, 'META-INF', 'MANIFEST.MF');
    return existsSync(file) ? fs.readFile(file, 'utf8') : null;
  }
  if (!plugin.endsWith('.jar')) return null;
  const result = spawnSync('tar', ['-xOf', plugin, 'META-INF/MANIFEST.MF'], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true});
  return result.status === 0 ? result.stdout : null;
}

// Fragments (e.g. the per-OS SWT implementation) are reported under their host
// so the inventory is the same on macOS and Windows.
async function bundleIndex(plugins) {
  const packages = new Map(); // package (slash form) -> [{bundle, version, internal, friends, fragment, location, classPath}]
  const versions = new Map(); // symbolic name -> version, used to fill in fragment hosts
  for (const name of (await fs.readdir(plugins)).sort()) {
    const location = path.join(plugins, name);
    const text = await readManifest(location);
    if (!text) continue;
    const headers = manifestHeaders(text);
    const symbolic = (headers['Bundle-SymbolicName'] ?? '').split(';')[0].trim();
    if (!symbolic) continue;
    const host = (headers['Fragment-Host'] ?? '').split(';')[0].trim();
    const classPath = (headers['Bundle-ClassPath'] ?? '.').split(',').map(s => s.split(';')[0].trim()).filter(Boolean);
    if (!versions.has(symbolic)) versions.set(symbolic, headers['Bundle-Version'] ?? '');
    for (const p of exportedPackages(headers['Export-Package'])) {
      const key = p.name.replaceAll('.', '/');
      if (!packages.has(key)) packages.set(key, []);
      packages.get(key).push({bundle: host || symbolic, version: null, internal: p.internal, friends: p.friends, fragment: host ? symbolic : null, location, classPath});
    }
  }
  for (const candidate of [...packages.values()].flat()) candidate.version = versions.get(candidate.bundle) ?? '';
  return packages;
}

// How the bridge manifest reaches each bundle: Require-Bundle, Import-Package,
// or only through another bundle's re-export (fragile: not under our control).
async function declaredDependencies() {
  const headers = manifestHeaders(await fs.readFile(bundleManifest, 'utf8'));
  const names = value => (value ?? '').split(',').map(s => s.split(';')[0].trim()).filter(Boolean);
  return {bundles: new Set(names(headers['Require-Bundle'])), packages: new Set(names(headers['Import-Package']).map(p => p.replaceAll('.', '/')))};
}

function reachedBy(bundle, declared) {
  if (declared.bundles.has(bundle.bundle)) return 'Require-Bundle';
  if (bundle.classes.some(c => declared.packages.has(packageOf(c.name.replaceAll('.', '/'))))) return 'Import-Package';
  return 'indirect (re-export)';
}

function listArchive(file) {
  const result = spawnSync('tar', ['-tf', file], {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true});
  return result.status === 0 ? result.stdout.split(/\r?\n/).filter(Boolean) : [];
}

// Class files a bundle provides, including jars named on its Bundle-ClassPath.
async function bundleContents(candidate, cache) {
  if (cache.has(candidate.location)) return cache.get(candidate.location);
  const classes = new Set();
  const stat = await fs.stat(candidate.location);
  for (const entry of candidate.classPath) {
    if (stat.isDirectory()) {
      const target = path.join(candidate.location, entry);
      if (entry === '.') {
        for (const file of await walk(candidate.location)) if (file.endsWith('.class')) classes.add(path.relative(candidate.location, file).replaceAll('\\', '/'));
      } else if (existsSync(target) && target.endsWith('.jar')) {
        for (const item of listArchive(target)) if (item.endsWith('.class')) classes.add(item);
      }
    } else if (entry === '.') {
      for (const item of listArchive(candidate.location)) if (item.endsWith('.class')) classes.add(item);
    }
  }
  cache.set(candidate.location, classes);
  return classes;
}

async function resolveOwner(owner, packages, cache) {
  const candidates = packages.get(packageOf(owner));
  if (!candidates?.length) return null;
  if (candidates.length === 1) return candidates[0];
  for (const candidate of candidates) if ((await bundleContents(candidate, cache)).has(owner + '.class')) return candidate;
  return candidates[0];
}

async function compile(knime, scratch) {
  const sources = (await walk(bundleSources)).filter(p => p.endsWith('.java')).sort();
  const classes = path.join(scratch, 'classes');
  const result = await javac({sources, classpath: await knimeClasspath(knime), out: classes, argfile: path.join(scratch, 'javac.args'), extra: ['-nowarn', '-proc:none']});
  if (result.error) throw new Error('javac: ' + result.error.message);
  if (result.status !== 0) throw new Error('javac failed: ' + (result.stderr || result.stdout).slice(0, 4000));
  return {classes, sources};
}

// Constant pool lines look like:
//   #12 = Methodref  #7.#8  // org/knime/core/node/workflow/WorkflowManager.getID:()Lorg/knime/core/node/workflow/NodeID;
//   #7 = Class       #9     // org/knime/core/node/workflow/WorkflowManager
export function constantPoolReferences(javapOutput) {
  const refs = [];
  for (const line of javapOutput.split(/\r?\n/)) {
    const match = /=\s+(Methodref|InterfaceMethodref|Fieldref|Class)\s+\S+\s+\/\/\s+(.+)$/.exec(line);
    if (!match) continue;
    const [, kind, target] = match;
    if (kind === 'Class') {
      const owner = elementType(target.replace(/^"|"$/g, ''));
      if (owner) refs.push({kind: 'class', owner});
    } else {
      const m = /^"?([^.]+(?:\.[^.:]+)*?)\.("?<?[A-Za-z0-9_$]+>?"?):(.*)$/.exec(target);
      if (!m) continue;
      const owner = elementType(m[1].replace(/^"|"$/g, ''));
      if (owner) refs.push({kind: kind === 'Fieldref' ? 'field' : 'method', owner, member: m[2].replace(/"/g, ''), descriptor: m[3]});
    }
  }
  return refs;
}

// "[Lorg/x/Y;" -> "org/x/Y"; primitive arrays such as "[B" -> null.
export function elementType(name) {
  if (!name.startsWith('[')) return name;
  const element = name.replace(/^\[+/, '');
  return element.startsWith('L') && element.endsWith(';') ? element.slice(1, -1) : null;
}

function external(owner) {
  return owner.includes('/') && !owner.startsWith(OWN_PREFIX) && !JDK_PREFIXES.some(p => owner.startsWith(p));
}

function packageOf(owner) { return owner.slice(0, owner.lastIndexOf('/')); }

async function reflectiveUses(sources) {
  const pattern = /forName\(|loadClass\(|getMethod\(|getDeclaredMethod\(|getDeclaredField\(|getField\(|setAccessible\(|Platform\.getBundle\(|method\([A-Z][A-Za-z]*\.class,"/;
  const uses = [];
  for (const file of sources) {
    const lines = (await fs.readFile(file, 'utf8')).split(/\r?\n/);
    lines.forEach((line, i) => { if (pattern.test(line)) uses.push({file: path.relative(root, file).replaceAll('\\', '/'), line: i + 1, code: line.trim()}); });
  }
  return uses;
}

function stability(info, owner) {
  if (!info) return 'unexported';
  if (info.internal || info.friends) return 'internal (x-internal/x-friends)';
  if (/\/(impl|internal)(\/|$)/.test(owner) || owner.startsWith('org/knime/ui/java/')) return 'implementation package';
  return 'exported';
}

export function toMarkdown(report) {
  const out = [];
  out.push('# KNIME API surface', '');
  out.push('Generated by `node scripts/api-surface.mjs`. Do not edit by hand; rerun after a KNIME bump or a change in the bundle sources and diff the result.', '');
  out.push(`- KNIME install: \`${report.knime.home}\``);
  out.push(`- \`org.knime.core\`: ${report.knime.coreVersion}`);
  out.push(`- Bridge sources: ${report.sourceFiles} files`);
  out.push(`- External classes referenced: ${report.summary.classes}, members: ${report.summary.members}, bundles: ${report.summary.bundles}`, '');
  out.push('Stability column: `exported` = public package of its bundle; `implementation package` = exported but named impl/internal or part of the KNIME UI backend (likely to change without notice); `internal` = marked x-internal or x-friends; `unexported` = not found in any Export-Package (would fail OSGi resolution).', '');
  out.push('Reached by: how the bridge `MANIFEST.MF` gets the bundle. `indirect (re-export)` resolves today only because another required bundle re-exports it; declare it explicitly when the manifest moves to Tycho (M1).', '');
  out.push('## Summary by bundle', '', '| Bundle | Version | Classes | Members | Stability | Reached by |', '|---|---|---|---|---|---|');
  for (const b of report.bundles) out.push(`| ${b.bundle} | ${b.version} | ${b.classes.length} | ${b.classes.reduce((n, c) => n + c.members.length, 0)} | ${[...new Set(b.classes.map(c => c.stability))].sort().join(', ')} | ${b.reachedBy} |`);
  out.push('', '## Reflective access (not visible to the compiler)', '', 'These break silently at runtime when KNIME renames or removes the target. Several call non-public KNIME methods with `setAccessible`. Check each one by hand on every KNIME bump.', '', '| Location | Code |', '|---|---|');
  for (const r of report.reflective) out.push(`| \`${r.file}:${r.line}\` | \`${r.code.replaceAll('|', '\\|')}\` |`);
  out.push('', '## Detail by bundle', '');
  for (const b of report.bundles) {
    out.push(`### ${b.bundle} (${b.version})`, '');
    for (const c of b.classes) {
      out.push(`- \`${c.name}\` (${c.stability})${c.members.length ? ':' : ''}`);
      for (const m of c.members) out.push(`  - \`${m}\``);
    }
    out.push('');
  }
  return out.join('\n');
}

export async function buildReport({knime}) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'knime-api-surface-'));
  try {
    const {classes, sources} = await compile(knime, scratch);
    const classFiles = (await walk(classes)).filter(p => p.endsWith('.class')).sort();
    const pool = run(javaTool('javap'), ['-v', '-p', ...classFiles]);
    const packages = await bundleIndex(path.join(knime, 'plugins'));
    const owners = new Map(); // owner -> Set(member signature)
    for (const ref of constantPoolReferences(pool)) {
      if (!external(ref.owner)) continue;
      if (!owners.has(ref.owner)) owners.set(ref.owner, new Set());
      if (ref.kind !== 'class') owners.get(ref.owner).add(`${ref.kind === 'field' ? 'field ' : ''}${ref.member}${ref.kind === 'method' ? ref.descriptor : ''}`);
    }
    const bundles = new Map(), contents = new Map();
    for (const [owner, members] of owners) {
      const info = await resolveOwner(owner, packages, contents);
      const key = info?.bundle ?? '(unresolved)';
      if (!bundles.has(key)) bundles.set(key, {bundle: key, version: info?.version ?? '', classes: []});
      bundles.get(key).classes.push({name: owner.replaceAll('/', '.'), stability: stability(info, owner), members: [...members].sort()});
    }
    const sorted = [...bundles.values()].sort((a, b) => a.bundle.localeCompare(b.bundle));
    const declared = await declaredDependencies();
    for (const b of sorted) { b.classes.sort((x, y) => x.name.localeCompare(y.name)); b.reachedBy = reachedBy(b, declared); }
    const core = [...packages.values()].flat().find(p => p.bundle === 'org.knime.core' && p.version);
    return {
      schemaVersion: 1,
      knime: {home: knime, coreVersion: core?.version ?? 'unknown'},
      sourceFiles: sources.length,
      summary: {bundles: sorted.length, classes: owners.size, members: [...owners.values()].reduce((n, s) => n + s.size, 0)},
      bundles: sorted,
      reflective: await reflectiveUses(sources),
    };
  } finally {
    await fs.rm(scratch, {recursive: true, force: true});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {values} = parseArgs({options: {knime: {type: 'string'}, json: {type: 'string'}, markdown: {type: 'string'}}, strict: true});
  const knime = path.resolve(values.knime ?? requireKnimeHome());
  const report = await buildReport({knime});
  const markdown = values.markdown ?? path.join(root, 'docs', 'KNIME_API_SURFACE.md');
  const json = values.json ?? path.join(root, 'docs', 'knime-api-surface.json');
  // The install path is machine-specific; keep it out of the committed files.
  const committed = {...report, knime: {...report.knime, home: path.basename(path.dirname(path.dirname(knime))) || knime}};
  await fs.writeFile(markdown, toMarkdown(committed) + '\n');
  await fs.writeFile(json, JSON.stringify(committed, null, 2) + '\n');
  console.log(JSON.stringify({markdown, json, ...report.summary, reflective: report.reflective.length}));
}
