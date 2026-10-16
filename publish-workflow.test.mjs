import {test} from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
test('publish workflow dual-publishes to npmjs and ants.land', ()=>{
  const y=fs.readFileSync('.github/workflows/publish.yml','utf8');
  assert.match(y, /registry\.npmjs\.org|NPM_TOKEN/);
  assert.match(y, /npm\.ants\.land/);
  assert.match(y, /NPM_CONFIG_USERCONFIG/);
  assert.match(y, /ANTS_TOKEN/);
});
