import test from 'node:test';
import {needsKnime} from './helpers/requirements.mjs';
import {javaTool,findKnimeHome} from '../scripts/lib/java-toolchain.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('native journal retention preserves authoritative status and expired UUID redelivery never repeats dispatch',{skip:needsKnime},async()=>{
  const plugins=path.join(findKnimeHome(),'plugins');
  const jars=(await fs.readdir(plugins)).filter(name=>/^com\.fasterxml\.jackson\.core\.jackson-(core|databind|annotations)_.*\.jar$/.test(name)).map(name=>path.join(plugins,name));
  assert.equal(jars.length,3,'installed KNIME Jackson jars are required for the OperationAccess harness');
  const scratch=path.join(root,'build','native-operation-retention-'+randomUUID());
  await fs.mkdir(scratch,{recursive:true});
  try {
    const fixtures=path.join(root,'tests/java/operation-retention-stubs');
    const sources=[path.join(root,'java/src/org/knime/agent/OperationAccess.java'),path.join(root,'tests/java/OperationRetentionHarness.java'),...(await fs.readdir(fixtures)).filter(name=>name.endsWith('.java')).map(name=>path.join(fixtures,name))];
    const compilation=spawnSync(javaTool('javac'),['--release','21','-encoding','UTF-8','-cp',jars.join(path.delimiter),'-d',scratch,...sources],{encoding:'utf8',windowsHide:true});
    assert.equal(compilation.status,0,compilation.stdout+compilation.stderr);
    const execution=spawnSync(javaTool('java'),['-ea','-cp',[scratch,...jars].join(path.delimiter),'org.knime.agent.OperationRetentionHarness',scratch],{encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(execution.status,0,execution.stdout+execution.stderr);
    assert.match(execution.stdout,/native operation retention behavior verified/);
  }finally {
    assert.equal(path.dirname(scratch),path.join(root,'build'));
    await fs.rm(scratch,{recursive:true,force:true});
  }
});
