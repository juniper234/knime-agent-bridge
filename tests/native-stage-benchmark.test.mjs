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
async function javaFiles(directory){const files=[];for(const item of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isDirectory())files.push(...await javaFiles(file));else if(file.endsWith('.java'))files.push(file);}return files;}

test('shared synthetic blocked-worker fixture measures baseline and changed health/receipt latency',{skip:needsKnime},async()=>{
  const plugins=path.join(findKnimeHome(),'plugins');
  const jars=(await fs.readdir(plugins)).filter(name=>/^com\.fasterxml\.jackson\.core\.jackson-(core|databind|annotations)_.*\.jar$/.test(name)).map(name=>path.join(plugins,name));
  const evidence=path.join(root,'build','native-stage-comparison-'+randomUUID());await fs.mkdir(evidence,{recursive:true});
  const comparison={boundary:'production scheduler, journal and real disk; synthetic native/Eclipse boundaries; no polling or host rendering',liveKnime:false,baselineCommit:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).stdout.trim(),node:process.version,platform:process.platform,java:spawnSync(javaTool('java'),['--version'],{encoding:'utf8',windowsHide:true}).stdout.trim(),clock:'System.nanoTime in each benchmark JVM; compare request duration distributions, never subtract separate-process timestamps'};
  for(const variant of ['baseline','changed']) {
    const scratch=path.join(evidence,variant);await fs.mkdir(scratch,{recursive:true});const sources=[];
    // Baseline = committed HEAD version of each file; a file not yet in HEAD (new or moved) uses the working copy.
    for(const name of ['BridgeActivator','OperationAccess','AtomicFiles','RequestTelemetry','RuntimeDirectory','WritePolicy','ScopePolicy']) {
      const file='java/src/org/knime/agent/'+name+'.java';
      const previous=variant==='baseline'?spawnSync('git',['show','HEAD:'+file],{cwd:root,encoding:'utf8',windowsHide:true}):null;
      if(previous?.status===0){const saved=path.join(scratch,name+'.java');await fs.writeFile(saved,previous.stdout);sources.push(saved);}
      else sources.push(path.join(root,file));
    }
    sources.push(...await javaFiles(path.join(root,'tests/java/stage-stubs')),path.join(root,'tests/java/StageTelemetryHarness.java'),path.join(root,'tests/java/StageLatencyHarness.java'));
    const compile=spawnSync(javaTool('javac'),['--release','21','-encoding','UTF-8','-cp',jars.join(path.delimiter),'-d',scratch,...sources],{encoding:'utf8',windowsHide:true});assert.equal(compile.status,0,compile.stdout+compile.stderr);
    const run=spawnSync(javaTool('java'),['-ea','-Dknime.agent.allowWrites=true','-cp',[scratch,...jars].join(path.delimiter),'org.knime.agent.StageLatencyHarness',scratch],{encoding:'utf8',windowsHide:true,timeout:30000});await fs.writeFile(path.join(scratch,'execution.txt'),run.stdout+run.stderr);assert.equal(run.status,0,run.stdout+run.stderr);
    comparison[variant]=JSON.parse(await fs.readFile(path.join(scratch,'measurements.json'),'utf8'));
    for(const op of ['health','operation.get'])assert.equal(comparison[variant][op].samples,25);
  }
  await fs.writeFile(path.join(evidence,'comparison.json'),JSON.stringify(comparison,null,2)+'\n');
  const rows=['variant,operation,samples,p50Ms,p95Ms,maxMs,responseBytes,benchmarkThreadCpuMs,heapBeforeBytes,heapAfterBytes'];
  for(const variant of ['baseline','changed'])for(const op of ['health','operation.get']) {const v=comparison[variant],m=v[op];rows.push([variant,op,m.samples,m.p50Ms,m.p95Ms,m.maxMs,m.responseBytes,v.threadCpuMs,v.heapBeforeBytes,v.heapAfterBytes].join(','));}
  await fs.writeFile(path.join(evidence,'comparison.csv'),rows.join('\n')+'\n');
  console.log('Synthetic baseline/changed timing evidence: '+path.join(evidence,'comparison.json'));
});
