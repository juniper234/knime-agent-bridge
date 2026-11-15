// Cross-platform discovery of the JDK, the KNIME installation and the bridge
// sources. Used by build.mjs, api-surface.mjs and the tests that compile Java.
import fs from 'node:fs/promises';
import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BUNDLE_ID = 'io.github.juniper234.knime.agentbridge';
export const bundleDir = path.join(root, 'java');
export const bundleSources = path.join(bundleDir, 'src');
export const bundleManifest = path.join(bundleDir, 'META-INF', 'MANIFEST.MF');
export const sourceFile = name => path.join(bundleSources, 'org', 'knime', 'agent', name + '.java');

const exe = name => process.platform === 'win32' ? name + '.exe' : name;

function compareVersionedNames(a, b) {
  const parts = s => (s.match(/\d+/g) ?? []).map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return a.localeCompare(b);
}

/** Eclipse home of the KNIME install (the folder holding plugins/ and knime.ini), or null. */
export function findKnimeHome(env = process.env) {
  if (env.KNIME_HOME) return path.resolve(env.KNIME_HOME);
  if (process.platform === 'darwin' && existsSync('/Applications')) {
    const app = readdirSync('/Applications').filter(name => /^KNIME.*\.app$/.test(name)).sort(compareVersionedNames).pop();
    if (app) return path.join('/Applications', app, 'Contents', 'Eclipse');
  }
  if (process.platform === 'win32' && env.LOCALAPPDATA) {
    const candidate = path.join(env.LOCALAPPDATA, 'Programs', 'KNIME');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function requireKnimeHome(env = process.env) {
  const home = findKnimeHome(env);
  if (!home || !existsSync(path.join(home, 'plugins'))) throw new Error('KNIME installation not found. Set KNIME_HOME to the folder that contains plugins/ (macOS: <KNIME app>/Contents/Eclipse).');
  return home;
}

/** Path of a JDK tool (javac, javap, jar, java): KNIME_AGENT_JDK, then JAVA_HOME, then PATH. */
export function javaTool(name, env = process.env) {
  for (const home of [env.KNIME_AGENT_JDK, env.JAVA_HOME]) {
    if (!home) continue;
    const candidate = path.join(home, 'bin', exe(name));
    if (existsSync(candidate)) return candidate;
  }
  return exe(name);
}

/** True when javac runs; tests that compile Java skip otherwise. */
export function hasJdk(env = process.env) {
  const result = spawnSync(javaTool('javac', env), ['-version'], {encoding: 'utf8', windowsHide: true});
  return result.status === 0;
}

export async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full)); else out.push(full);
  }
  return out;
}

export async function javaFiles(dir) {
  return (await walk(dir)).filter(p => p.endsWith('.java')).sort();
}

/** Every JAR under plugins/ plus each unpacked bundle directory. Eclipse bundles may be either. */
export async function knimeClasspath(knime) {
  const plugins = path.join(knime, 'plugins');
  const jars = (await walk(plugins)).filter(p => p.endsWith('.jar'));
  const dirs = (await fs.readdir(plugins, {withFileTypes: true})).filter(e => e.isDirectory()).map(e => path.join(plugins, e.name));
  return [...jars, ...dirs];
}

export const quote = s => '"' + s.replaceAll('\\', '/') + '"';

/** Run javac with an argument file (the classpath is far too long for a command line on Windows). */
export async function javac({sources, classpath = [], out, argfile, release = '21', extra = [], env = process.env, stdio = 'pipe'}) {
  await fs.mkdir(out, {recursive: true});
  const args = ['--release', release, '-encoding', 'UTF-8', ...extra, ...(classpath.length ? ['-classpath', quote(classpath.join(path.delimiter))] : []), '-d', quote(out), ...sources.map(quote)];
  await fs.writeFile(argfile, args.join('\n'));
  return spawnSync(javaTool('javac', env), ['@' + argfile], {encoding: 'utf8', stdio, windowsHide: true, maxBuffer: 64 * 1024 * 1024});
}

/** Classpath recorded by the last scripts/build.mjs run (build/javac.args), used by probe tests. */
export async function recordedClasspath() {
  const args = (await fs.readFile(path.join(root, 'build', 'javac.args'), 'utf8')).split(/\r?\n/);
  return args[args.indexOf('-classpath') + 1].replace(/^"|"$/g, '');
}
