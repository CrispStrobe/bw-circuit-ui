// Test-only oracle: actual solver vectors, never rounded .meas scalars.
import {createHash} from 'node:crypto';
import {accessSync, constants, mkdtempSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {delimiter, isAbsolute, join} from 'node:path';
import {spawnSync} from 'node:child_process';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const preciseNumber = /^[+-]?\d\.\d{15,}[eE][+-]?\d+$/;
export function parseNgspiceVector(text, vector) {
  const lines = text.trim().split(/\r?\n/), header = lines.shift()?.trim().split(/\s+/);
  if (header?.length !== 2 || header[0] !== 'time' || header[1] !== vector) throw new Error('Missing or unexpected ngspice vector header');
  const points = [];
  for (const line of lines) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length !== 2 || !tokens.every(s => preciseNumber.test(s))) throw new Error('Expected full-precision ngspice time/value pair');
    const [time, value] = tokens.map(Number);
    if (!Number.isFinite(time) || !Number.isFinite(value) || time < 0) throw new Error('Nonfinite or negative-time ngspice vector');
    if (points.length && time <= points.at(-1).time) throw new Error('Duplicate or nonmonotonic ngspice vector time');
    points.push({time, value, raw: line});
  }
  if (points.length < 2) throw new Error('Missing ngspice vector observations');
  return points;
}
export function observeVector(points, times) {
  if (!times.length || times.some((t,i) => !Number.isFinite(t) || t < 0 || (i && t <= times[i-1]))) throw new Error('Observation times must be finite and strictly increasing');
  return times.map(time => {
    if (time < points[0].time || time > points.at(-1).time) throw new Error(`Missing bracketing solver points for ${time}s`);
    let low = 0, high = points.length-1;
    while (high-low > 1) {const mid = (low+high)>>1; if (points[mid].time <= time) low=mid; else high=mid;}
    const left=points[low], right=points[high];
    // Exact solver observations are already measured values. Reconstructing an
    // endpoint can cancel a small value to zero or overflow a finite bracket.
    const value=time === left.time ? left.value : time === right.time ? right.value :
      left.value+(right.value-left.value)*(time-left.time)/(right.time-left.time);
    if (!Number.isFinite(value)) throw new Error('Nonfinite interpolated oracle value');
    return {time, value, left, right};
  });
}
export function validateOracleProcess(process) {
  if (process.error || process.status !== 0 || /^\s*(?:error|fatal|.*simulation.*aborted)\s*[:!]?/im.test(`${process.stdout}\n${process.stderr}`)) {
    throw new Error(`ngspice did not complete successfully: ${process.error || process.stderr || process.stdout}`);
  }
}
function executablePath(binary) {
  const paths=isAbsolute(binary)?[binary]:(process.env.PATH||'').split(delimiter).map(p=>join(p,binary));
  for (const path of paths) try {accessSync(path,constants.X_OK); return realpathSync(path);} catch {/* next PATH entry */}
  throw new Error(`ngspice executable unavailable: ${binary}`);
}
export function runNgspiceVector({deck, vector, times, binary='ngspice'}) {
  if (!/^v\([a-z0-9_.:+-]+\)$/i.test(vector)) throw new Error('Expected one authored voltage vector');
  if (/^\s*\.control\b/im.test(deck) || (deck.match(/^\s*\.end\s*$/gim)||[]).length !== 1) throw new Error('Oracle deck must have one .end and no control block');
  const executable=executablePath(binary);
  const version=spawnSync(executable,['--version'],{encoding:'utf8',timeout:30_000});
  validateOracleProcess(version);
  const versions=[...version.stdout.matchAll(/\bngspice-(\d+)\s*:/g)].map(m=>Number(m[1]));
  if (versions.length !== 1) throw new Error('Ambiguous ngspice version');
  const directory=mkdtempSync(join(tmpdir(),'cui-spice-vector-'));
  const vectorFile=join(directory,'vector.txt'), deckFile=join(directory,'input.cir');
  const input=deck.replace(/^\s*\.end\s*$/im,`.control\nset numdgt=17\nset wr_vecnames\nset wr_singlescale\nrun\nwrdata vector.txt ${vector}\nquit\n.endc\n.end`);
  writeFileSync(deckFile,input);
  const result=spawnSync(executable,['-n','-b',deckFile],{cwd:directory,encoding:'utf8',timeout:60_000,maxBuffer:16*1024*1024});
  writeFileSync(join(directory,'stdout.txt'),result.stdout||''); writeFileSync(join(directory,'stderr.txt'),result.stderr||'');
  const identity={executable, executableSha256:hash(readFileSync(executable)), version:versions[0], versionBanner:version.stdout,
    args:['-n','-b',deckFile], cwd:directory, compatibility:'personal initialization disabled', vector, times, deckSha256:hash(input), directory, status:result.status};
  writeFileSync(join(directory,'identity.json'),JSON.stringify(identity,null,2)+'\n');
  try {
    validateOracleProcess(result);
    const raw=readFileSync(vectorFile,'utf8'); identity.vectorSha256=hash(raw);
    const readings=observeVector(parseNgspiceVector(raw,vector),times);
    writeFileSync(join(directory,'identity.json'),JSON.stringify(identity,null,2)+'\n');
    writeFileSync(join(directory,'observations.json'),JSON.stringify(readings,null,2)+'\n');
    return {readings, identity, raw, stdout:result.stdout, stderr:result.stderr};
  } catch (error) {throw new Error(`${error.message}; retained oracle evidence: ${directory}`,{cause:error});}
}
