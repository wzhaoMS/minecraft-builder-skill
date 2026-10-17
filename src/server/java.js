/**
 * Locate a suitable Java runtime (or install a private Temurin JRE into <serverDir>/.java).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolveJava, download } from './downloads.js';

const exe = process.platform === 'win32' ? 'java.exe' : 'java';

/** Parse `java -version` output → major version number or null. */
export function parseJavaVersion(text) {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(text);
  if (!m) return null;
  const major = Number(m[1]);
  return major === 1 ? Number(m[2]) : major;
}

export function javaVersionOf(javaPath) {
  // `java -version` prints to stderr and exits 0.
  const r = spawnSync(javaPath, ['-version'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  if (r.error) return null;
  return parseJavaVersion(`${r.stderr ?? ''}${r.stdout ?? ''}`);
}

function findInDir(root) {
  if (!root || !fs.existsSync(root)) return [];
  const out = [];
  const direct = path.join(root, 'bin', exe);
  if (fs.existsSync(direct)) out.push(direct);
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const cand of [path.join(root, d.name, 'bin', exe), path.join(root, d.name, 'Contents', 'Home', 'bin', exe)]) {
      if (fs.existsSync(cand)) out.push(cand);
    }
  }
  return out;
}

/** Candidate java executables, best first. */
export function javaCandidates(serverDir) {
  const c = [];
  if (serverDir) c.push(...findInDir(path.join(serverDir, '.java')));
  if (process.env.JAVA_HOME) c.push(path.join(process.env.JAVA_HOME, 'bin', exe));
  c.push(exe); // PATH
  if (process.platform === 'win32') {
    for (const base of ['C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Java', 'C:\\Program Files\\Microsoft', path.join(os.homedir(), 'tools')]) {
      c.push(...findInDir(base));
    }
  } else if (process.platform === 'darwin') {
    c.push(...findInDir('/Library/Java/JavaVirtualMachines'));
    c.push('/opt/homebrew/opt/openjdk@21/bin/java', '/opt/homebrew/opt/openjdk/bin/java', '/usr/local/opt/openjdk@21/bin/java');
  } else {
    c.push(...findInDir('/usr/lib/jvm'));
  }
  return [...new Set(c)];
}

/** @returns {{ path: string, version: number } | null} first java with major ≥ min */
export function findJava(min = 21, serverDir = null) {
  for (const cand of javaCandidates(serverDir)) {
    const v = javaVersionOf(cand);
    if (v && v >= min) return { path: cand, version: v };
  }
  return null;
}

export function javaInstallHint(min = 21) {
  switch (process.platform) {
    case 'win32': return `winget install EclipseAdoptium.Temurin.${min}.JRE   (or: mcb server setup --install-java)`;
    case 'darwin': return `brew install openjdk@${min}   (or: mcb server setup --install-java)`;
    default: return `sudo apt install openjdk-${min}-jre-headless   (or: mcb server setup --install-java)`;
  }
}

/** Download Temurin JRE into <serverDir>/.java and return its java path. */
export async function installJava(serverDir, min = 21, log = () => {}) {
  const info = await resolveJava(min);
  const dir = path.join(serverDir, '.java');
  fs.mkdirSync(dir, { recursive: true });
  const archive = path.join(dir, info.name);
  log(`downloading ${info.release} (${info.name})…`);
  await download(info.url, archive, { sha256: info.sha256 });
  log('extracting…');
  // bsdtar (Windows 10+, macOS) and GNU tar both handle .tar.gz; Windows tar also handles .zip.
  execFileSync('tar', ['-xf', archive, '-C', dir], { stdio: 'ignore' });
  fs.rmSync(archive, { force: true });
  const found = findInDir(dir).find((p) => (javaVersionOf(p) ?? 0) >= min);
  if (!found) throw new Error(`Java was extracted to ${dir} but no usable java executable was found`);
  return { path: found, version: javaVersionOf(found) };
}
