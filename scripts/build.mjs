#!/usr/bin/env node
// Developer build: compile the bridge bundle against an installed KNIME and package
// artifacts/<bundle>_<version>-<revision>.jar for scripts/launch.mjs and the probe tests.
// Release builds use Maven/Tycho (`mvn verify`), which needs no KNIME install.
// Needs a JDK 21+ (KNIME_AGENT_JDK, JAVA_HOME or PATH) and KNIME (KNIME_HOME or the default install).
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {root, BUNDLE_ID, bundleSources, bundleManifest, requireKnimeHome, javaTool, javaFiles, knimeClasspath, javac} from './lib/java-toolchain.mjs';

const knime = requireKnimeHome();
const packageVersion = async () => JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;

// Do not package stale classes or label a compilation with source edited midway.
async function inputsDigest() {
  const hash = createHash('sha256');
  hash.update(await fs.readFile(bundleManifest));
  for (const source of await javaFiles(bundleSources)) {
    hash.update(path.relative(root, source).replaceAll('\\', '/'));
    hash.update(await fs.readFile(source));
  }
  return hash.digest('hex');
}
async function assertUnchanged(frozen, version, stage) {
  if (await inputsDigest() !== frozen || await packageVersion() !== version) throw new Error(`Build inputs changed during ${stage}. Freeze source and rebuild; no artifact was published.`);
}

const frozenInputs = await inputsDigest(), version = await packageVersion(), revision = frozenInputs.slice(0, 12);
const manifestText = await fs.readFile(bundleManifest, 'utf8');
const bundleVersion = /^Bundle-Version:\s*(\S+)/m.exec(manifestText)?.[1];
if (!bundleVersion?.startsWith(version + '.')) throw new Error(`MANIFEST.MF Bundle-Version ${bundleVersion} does not match package.json version ${version}.`);

const build = path.join(root, 'build'), classes = path.join(build, 'classes');
await fs.mkdir(build, {recursive: true});
if (path.relative(build, await fs.realpath(build)) !== '') throw new Error('Build directory resolves outside its exact location.');
try { if (path.relative(classes, await fs.realpath(classes)) !== '') throw new Error('Refusing to clean a redirected build/classes directory.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.rm(classes, {recursive: true, force: true});

const compiled = await javac({sources: await javaFiles(bundleSources), classpath: await knimeClasspath(knime), out: classes, argfile: path.join(build, 'javac.args'), stdio: 'inherit'});
if (compiled.error) throw compiled.error;
if (compiled.status !== 0) process.exit(compiled.status || 1);
await assertUnchanged(frozenInputs, version, 'compilation');

// Replace the Tycho ".qualifier" placeholder with the source revision so the JAR is a valid, traceable OSGi version.
const manifest = path.join(build, 'MANIFEST.MF');
await fs.writeFile(manifest, manifestText.replace(/^(Bundle-Version:\s*\S+?)\.qualifier\s*$/m, `$1.dev${revision}`));
const artifact = path.join(root, 'artifacts', `${BUNDLE_ID}_${version}-${revision}.jar`);
await fs.mkdir(path.dirname(artifact), {recursive: true});
const temporary = artifact + '.' + randomUUID() + '.tmp';
const packed = spawnSync(javaTool('jar'), ['--create', '--file', temporary, '--manifest', manifest, '-C', classes, '.'], {stdio: 'inherit', windowsHide: true});
if (packed.error) throw packed.error;
if (packed.status !== 0) process.exit(packed.status || 1);
try { await assertUnchanged(frozenInputs, version, 'archive assembly'); }
catch (error) { await fs.unlink(temporary); throw error; }
try { await fs.access(artifact); await fs.unlink(temporary); }
catch (error) { if (error.code !== 'ENOENT') throw error; await fs.rename(temporary, artifact); }
await fs.writeFile(path.join(root, 'artifacts', 'latest.json'), JSON.stringify({bundle: path.basename(artifact), revision, targetJava: 21}, null, 2) + '\n');
console.log(JSON.stringify({artifact, knime, targetJava: 21}));
