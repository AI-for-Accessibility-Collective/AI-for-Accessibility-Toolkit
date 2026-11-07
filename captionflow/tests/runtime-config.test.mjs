import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadCaptionFlowEnv, resolveCaptionFlowPython } from '../src/runtime-config.mjs';

test('explicit Python path wins and is relative to repository root', () => {
  assert.equal(resolveCaptionFlowPython({env:{CAPTIONFLOW_PYTHON:'captionflow/myvenv/bin/python'},repoDir:'/repo',exists:()=>false}),resolve('/repo/captionflow/myvenv/bin/python'));
  assert.equal(resolveCaptionFlowPython({env:{CAPTIONFLOW_PYTHON:'python3'},exists:()=>false}), 'python3');
});

test('uses activated custom virtualenv regardless of its name/location', () => {
  const selected=join('/custom location','my-own-env','bin','python');
  assert.equal(resolveCaptionFlowPython({env:{VIRTUAL_ENV:join('/custom location','my-own-env')},exists:path=>path===selected,projectDir:'/project',repoDir:'/repo'}), selected);
});

test('finds conventional project venv when no environment is activated', () => {
  const selected=join('/project','.venv','bin','python');
  assert.equal(resolveCaptionFlowPython({env:{},exists:path=>path===selected,projectDir:'/project',repoDir:'/repo'}),selected);
});

test('falls back to PATH; Windows virtualenv uses Scripts/python.exe', () => {
  assert.equal(resolveCaptionFlowPython({env:{},exists:()=>false,platform:'linux'}),'python3');
  const selected=join('C:/venv','Scripts','python.exe');
  assert.equal(resolveCaptionFlowPython({env:{VIRTUAL_ENV:'C:/venv'},exists:path=>path===selected,platform:'win32'}),selected);
  assert.equal(resolveCaptionFlowPython({env:{},exists:()=>false,platform:'win32'}),'python');
});

test('optional .env is loaded and shell vars remain authoritative', async () => {
  const folder=await mkdtemp(join(tmpdir(),'captionflow-env-test-'));
  const file=join(folder,'.env');
  const key='CAPTIONFLOW_TEST_ENV_LOADED';
  const precedence='CAPTIONFLOW_TEST_ENV_PRECEDENCE';
  const beforeKey=process.env[key], beforePrecedence=process.env[precedence];
  try {
    await writeFile(file,`${key}=present\n${precedence}=from-file\n`);
    process.env[precedence]='from-shell';
    assert.equal(loadCaptionFlowEnv({file}).loaded,true);
    assert.equal(process.env[key],'present');
    assert.equal(process.env[precedence],'from-shell');
    assert.equal(loadCaptionFlowEnv({file:join(folder,'nonexistent')}).loaded,false);
  } finally {
    if(beforeKey===undefined)delete process.env[key];else process.env[key]=beforeKey;
    if(beforePrecedence===undefined)delete process.env[precedence];else process.env[precedence]=beforePrecedence;
    await rm(folder,{recursive:true,force:true});
  }
});