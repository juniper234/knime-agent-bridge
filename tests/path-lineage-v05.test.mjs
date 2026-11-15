import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {needsJdk} from './helpers/requirements.mjs';
import {javaTool} from '../scripts/lib/java-toolchain.mjs';
test('production physical path gate refuses inherited parent paths and preserves unknown provenance',{skip:needsJdk},async t=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'knime-path-gate-'));t.after(()=>fs.rm(tmp,{recursive:true,force:true}));
 const classes=path.join(tmp,'classes');await fs.mkdir(classes);
 const compile=spawnSync(javaTool('javac'),['-encoding','UTF-8','-d',classes,'java/src/org/knime/agent/PathLineage.java','tests/java/PathLineageHarness.java'],{encoding:'utf8',windowsHide:true});assert.equal(compile.status,0,compile.stderr);
 const run=spawnSync(javaTool('java'),['-cp',classes,'org.knime.agent.PathLineageHarness',tmp],{encoding:'utf8',windowsHide:true});assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/PASS PathLineage/);
});
