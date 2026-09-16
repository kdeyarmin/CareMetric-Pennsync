import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintWorkflowDirectory } from './tools-actionlint.mjs';
const VALID = 'name: Test\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n';
async function fixture(t) { const dir=await mkdtemp(join(tmpdir(),'actionlint-regression-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir; }
test('each workflow receives an independent linter instance and no file is skipped',async t=>{
 const dir=await fixture(t);for(const name of ['a.yml','b.yml','c.yaml'])await writeFile(join(dir,name),VALID);
 let instances=0;const seen=[];
 const result=await lintWorkflowDirectory(dir,{makeLinter:async()=>{instances++;let used=false;return (text,path)=>{assert.equal(used,false);used=true;assert.equal(text,VALID);seen.push(path);return [];};}});
 assert.equal(instances,3);assert.equal(new Set(seen).size,3);assert.equal(result.files,3);assert.deepEqual(result.problems,[]);
});
test('real WASM validates later files and reports their errors instead of masking them',async t=>{
 const dir=await fixture(t);await writeFile(join(dir,'a.yml'),VALID);await writeFile(join(dir,'b.yml'),VALID);await writeFile(join(dir,'c.yml'),VALID.replace('runs-on: ubuntu-latest','invalid-job-key: true'));
 const result=await lintWorkflowDirectory(dir);assert.equal(result.files,3);assert.ok(result.problems.length>0);assert.ok(result.problems.some(p=>p.file.endsWith('c.yml')));
});
test('missing files, empty inventories, crashes and malformed results cannot report success',async t=>{
 const dir=await fixture(t);await assert.rejects(()=>lintWorkflowDirectory(dir));await assert.rejects(()=>lintWorkflowDirectory(join(dir,'missing')));
 await writeFile(join(dir,'one.yml'),VALID);
 await assert.rejects(()=>lintWorkflowDirectory(dir,{makeLinter:async()=>()=>{throw new Error('synthetic trap');}}),/synthetic trap/);
 await assert.rejects(()=>lintWorkflowDirectory(dir,{makeLinter:async()=>()=>null}),/incomplete/);
});
