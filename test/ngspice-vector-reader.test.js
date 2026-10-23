import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseNgspiceVector,observeVector,validateOracleProcess,runNgspiceVector} from './helpers/ngspice-vector.js';
const raw='time v(out)\n0.00000000000000000e+00 1.00000000000000000e+00\n1.00000000000000000e+00 3.00000000000000000e+00\n';
test('full-precision observations preserve solver brackets and authored times',()=>{
 const points=parseNgspiceVector(raw,'v(out)'),r=observeVector(points,[0,.25,1]);
 assert.deepEqual(r.map(p=>p.value),[1,1.5,3]);assert.deepEqual(r.map(p=>p.time),[0,.25,1]);
 assert.equal(r[1].left.raw,raw.split('\n')[1]);assert.equal(r[1].right.raw,raw.split('\n')[2]);
});
for(const [name,text] of [
 ['rounded scalar','out0 = 1.23457e+00'],['rounded vector',raw.replace('3.00000000000000000e+00','3.00000e+00')],
 ['missing row',raw.split('\n').slice(0,2).join('\n')],['duplicate row',raw+raw.split('\n')[2]],
 ['wrong vector',raw.replace('v(out)','v(other)')],['nonfinite',raw.replace('3.00000000000000000e+00','1.00000000000000000e+999')],
 ['extra column',raw.replace('3.00000000000000000e+00','3.00000000000000000e+00 4')],
])test(`${name} cannot become a precise oracle observation`,()=>assert.throws(()=>parseNgspiceVector(text,'v(out)')));
test('absent, duplicate and invalid requested instants refuse',()=>{
 const points=parseNgspiceVector(raw,'v(out)');for(const times of [[],[2],[.25,.25],[NaN],[-1]])assert.throws(()=>observeVector(points,times));
});
test('a failed or error-reporting process cannot supply measurements even with zero exit',()=>{
 validateOracleProcess({status:0,stdout:'No. of Data Rows : 2',stderr:''});
 for(const p of [{status:1},{status:0,stdout:'Error: transient aborted'},{status:0,stderr:'Fatal: missing model'}])assert.throws(()=>validateOracleProcess(p));
});
test('real raw values satisfy the unchanged microvolt bound where rounded .meas text does not',{
 skip:spawnSync('ngspice',['--version']).status!==0?'ngspice unavailable: independent comparison did not run':false,
},()=>{
 const result=runNgspiceVector({deck:'self-authored source-constrained inductor\nL1 1 0 1\nI1 0 1 SIN(0 1 1 0)\n.tran .001 1 0 .0001\n.end\n',vector:'v(1)',times:[.51]});
 const expected=2*Math.PI*Math.cos(2*Math.PI*.51),actual=result.readings[0].value;
 assert.ok(Math.abs(actual-expected)<1e-6,`${actual} vs ${expected}`);
 assert.ok(Math.abs(Number(actual.toExponential(5))-expected)>1e-6,'rounded mutant must fail the unchanged bound');
 assert.match(result.identity.executableSha256,/^[0-9a-f]{64}$/);assert.match(result.identity.vectorSha256,/^[0-9a-f]{64}$/);
 assert.deepEqual(result.identity.args.slice(0,2),['-n','-b']);
 assert.equal(readFileSync(join(result.identity.directory,'vector.txt'),'utf8'),result.raw);
});
