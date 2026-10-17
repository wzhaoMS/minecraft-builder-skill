/**
 * Local Paper server management: setup, start, stop, status, logs. Cross-platform (Windows/macOS/Linux).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolvePaper, resolveFawe, download, DEFAULT_MC_VERSION } from './downloads.js';
import { findJava, installJava, javaInstallHint } from './java.js';
import { RconClient } from '../transport/rcon.js';

const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const PID_FILE = '.mcb-server.pid';
export const STATE_FILE = '.mcb-server.json';

/** Offline-mode UUID (what the server uses for name-only logins): UUID v3 of "OfflinePlayer:<name>". */
export function offlineUuid(name) {
  const h = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Read server.properties preserving line order. */
export function readProperties(file) {
  const props = new Map();
  if (!fs.existsSync(file)) return props;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    props.set(line.slice(0, i).trim(), line.slice(i + 1).replace(/\\:/g, ':').replace(/\\=/g, '='));
  }
  return props;
}

export function writeProperties(file, updates) {
  const props = readProperties(file);
  for (const [k, v] of Object.entries(updates)) if (v !== undefined && v !== null) props.set(k, String(v));
  const esc = (v) => v.replace(/:/g, '\\:');
  const body = [...props.entries()].map(([k, v]) => `${k}=${k === 'generator-settings' ? v : esc(v)}`).join('\n');
  fs.writeFileSync(file, `#Minecraft server properties (managed by mcb)\n${body}\n`);
}

const FLAT_SETTINGS = JSON.stringify({
  biome: 'minecraft:plains',
  layers: [
    { block: 'minecraft:bedrock', height: 1 },
    { block: 'minecraft:dirt', height: 2 },
    { block: 'minecraft:grass_block', height: 1 },
  ],
});

/**
 * Create / update a local build server.
 * @returns {Promise<object>} summary (paths, versions, ports, password)
 */
export async function setupServer(o) {
  const log = o.log ?? (() => {});
  const dir = path.resolve(o.dir);
  fs.mkdirSync(dir, { recursive: true });
  const mcVersion = o.mcVersion ?? DEFAULT_MC_VERSION;
  const summary = { dir, mcVersion };

  // Paper
  const jar = path.join(dir, 'paper.jar');
  const statePath = path.join(dir, STATE_FILE);
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
  const paper = await resolvePaper(mcVersion);
  summary.paper = { version: paper.version, build: paper.build, javaMin: paper.javaMin };
  if (!fs.existsSync(jar) || state.paperSha256 !== paper.sha256 || o.forceDownload) {
    log(`downloading Paper ${paper.version} build ${paper.build}…`);
    await download(paper.url, jar, { sha256: paper.sha256 });
    state.paperSha256 = paper.sha256;
    state.mcVersion = paper.version;
    state.paperBuild = paper.build;
  } else {
    log(`Paper ${paper.version} build ${paper.build} already present`);
  }

  // Java
  let java = findJava(paper.javaMin, dir);
  if (!java && o.installJava) {
    log(`installing Java ${paper.javaMin} (Temurin JRE) into ${path.join(dir, '.java')}…`);
    java = await installJava(dir, paper.javaMin, log);
  }
  summary.java = java ?? { missing: true, needed: paper.javaMin, hint: javaInstallHint(paper.javaMin) };
  if (java) state.java = java.path;

  // EULA
  const eulaFile = path.join(dir, 'eula.txt');
  const eulaOk = fs.existsSync(eulaFile) && /eula\s*=\s*true/i.test(fs.readFileSync(eulaFile, 'utf8'));
  if (!eulaOk) {
    if (!o.acceptEula) {
      summary.eula = 'not-accepted';
    } else {
      fs.writeFileSync(eulaFile, `# Accepted via mcb --accept-eula (https://aka.ms/MinecraftEULA)\neula=true\n`);
      summary.eula = 'accepted';
    }
  } else summary.eula = 'accepted';

  // server.properties
  const propsFile = path.join(dir, 'server.properties');
  const existing = readProperties(propsFile);
  const rconPassword = o.rconPassword ?? existing.get('rcon.password') ?? crypto.randomBytes(9).toString('base64url');
  const port = o.port ?? Number(existing.get('server-port') ?? 25565);
  const rconPort = o.rconPort ?? Number(existing.get('rcon.port') ?? 25575);
  const fresh = !existing.size;
  const updates = {
    'server-port': port,
    'enable-rcon': 'true',
    'rcon.port': rconPort,
    'rcon.password': rconPassword,
    'broadcast-rcon-to-ops': 'false',
    'online-mode': o.onlineMode === undefined ? (existing.get('online-mode') ?? 'false') : String(!!o.onlineMode),
    'allow-flight': 'true',
    'spawn-protection': '0',
  };
  if (fresh) {
    Object.assign(updates, {
      motd: 'mcb build server',
      gamemode: 'creative',
      difficulty: 'peaceful',
      'max-players': 10,
      'view-distance': 10,
      'simulation-distance': 8,
      'generate-structures': 'false',
      'level-name': 'world',
      // Offline-mode servers let anyone join under any name (including op'd ones), so a fresh
      // build server only listens on this machine unless --lan is given.
      'server-ip': o.lan ? '' : '127.0.0.1',
    });
    if ((o.world ?? 'flat') === 'flat') {
      updates['level-type'] = 'minecraft:flat';
      updates['generator-settings'] = FLAT_SETTINGS;
    }
  } else if (o.lan !== undefined) {
    updates['server-ip'] = o.lan ? '' : '127.0.0.1';
  }
  writeProperties(propsFile, updates);
  Object.assign(summary, { port, rconPort, rconPassword, onlineMode: updates['online-mode'] === 'true', world: fresh ? (o.world ?? 'flat') : 'existing' });

  // ops.json (offline UUIDs) — works before first start; `mcb server op` handles running servers.
  const opsFile = path.join(dir, 'ops.json');
  const ops = fs.existsSync(opsFile) ? JSON.parse(fs.readFileSync(opsFile, 'utf8') || '[]') : [];
  for (const name of [o.botName ?? 'BuilderBot', ...(o.ops ?? [])]) {
    if (!ops.some((e) => e.name?.toLowerCase() === name.toLowerCase())) {
      ops.push({ uuid: offlineUuid(name), name, level: 4, bypassesPlayerLimit: false });
    }
  }
  fs.writeFileSync(opsFile, JSON.stringify(ops, null, 2));
  summary.ops = ops.map((e) => e.name);

  // FAWE (optional)
  if (o.fawe) {
    const fawe = await resolveFawe(mcVersion);
    const dest = path.join(dir, 'plugins', 'FastAsyncWorldEdit.jar');
    if (state.faweVersion !== fawe.version || !fs.existsSync(dest)) {
      log(`downloading FastAsyncWorldEdit ${fawe.version}…`);
      await download(fawe.url, dest, { sha512: fawe.sha512 });
      state.faweVersion = fawe.version;
    }
    summary.fawe = fawe.version;
  }

  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  return summary;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/**
 * Is this PID a Java process? true / false / null (couldn't tell). Guards against PID reuse:
 * after a reboot the PID in the pid file may belong to something else entirely.
 */
export function pidIsJava(pid) {
  try {
    if (process.platform === 'linux') {
      return /java/i.test(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'));
    }
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
      if (!out.includes(`"${pid}"`)) return false;
      return /"javaw?\.exe"/i.test(out);
    }
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 10_000 });
    return out.trim() ? /java/i.test(out) : false;
  } catch {
    return null;
  }
}

export function readPid(dir) {
  const f = path.join(dir, PID_FILE);
  if (!fs.existsSync(f)) return null;
  const pid = Number(fs.readFileSync(f, 'utf8').trim());
  if (!Number.isInteger(pid) || !pidAlive(pid)) return null;
  return pidIsJava(pid) === false ? null : pid; // stale pid file, PID reused by another program
}

/** Server list ping → { version, protocol, players, motd } or null. */
export async function pingServer(host, port, timeoutMs = 4000) {
  const mc = require('minecraft-protocol');
  try {
    const r = await Promise.race([
      mc.ping({ host, port, closeTimeout: timeoutMs }),
      sleep(timeoutMs).then(() => null),
    ]);
    if (!r) return null;
    const desc = typeof r.description === 'string' ? r.description : r.description?.text ?? '';
    return { version: r.version?.name, protocol: r.version?.protocol, players: r.players?.online ?? 0, max: r.players?.max, motd: desc };
  } catch {
    return null;
  }
}

/**
 * Start the server in the background (stdin ignored — the classic "hangs without < /dev/null" fix).
 * Waits until it accepts connections (unless wait=false).
 */
export async function startServer(o) {
  const log = o.log ?? (() => {});
  const dir = path.resolve(o.dir);
  if (!fs.existsSync(path.join(dir, 'paper.jar'))) throw Object.assign(new Error(`No paper.jar in ${dir}`), { hint: 'Run `mcb server setup --accept-eula` first.' });
  const eula = path.join(dir, 'eula.txt');
  if (!fs.existsSync(eula) || !/eula\s*=\s*true/i.test(fs.readFileSync(eula, 'utf8'))) {
    throw Object.assign(new Error('The Minecraft EULA has not been accepted for this server'), { hint: 'Read https://aka.ms/MinecraftEULA then run `mcb server setup --accept-eula`.' });
  }
  const props = readProperties(path.join(dir, 'server.properties'));
  const port = Number(props.get('server-port') ?? 25565);
  const running = readPid(dir);
  if (running) {
    log(`server already running (pid ${running})`);
    return { pid: running, port, already: true };
  }
  const busy = await pingServer('127.0.0.1', port, 1500);
  if (busy) {
    throw Object.assign(new Error(`Port ${port} is already used by another running server (${busy.version ?? 'unknown version'})`), {
      code: 'PORT_IN_USE',
      hint: `Build on that server instead (mcb doctor --port ${port}), stop it, or change server-port in ${path.join(dir, 'server.properties')}.`,
    });
  }
  const state = fs.existsSync(path.join(dir, STATE_FILE)) ? JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), 'utf8')) : {};
  const java = o.java ?? state.java ?? findJava(21, dir)?.path;
  if (!java) throw Object.assign(new Error('Java 21+ not found'), { hint: javaInstallHint(21) });
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  const out = fs.openSync(path.join(dir, 'logs', 'mcb-console.log'), 'a');
  const mem = o.memory ?? '2G';
  const child = spawn(java, [`-Xms${mem}`, `-Xmx${mem}`, '-XX:+UseG1GC', '-jar', 'paper.jar', '--nogui'], {
    cwd: dir,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  fs.writeFileSync(path.join(dir, PID_FILE), String(child.pid));
  log(`started Paper (pid ${child.pid}), waiting for it to accept connections…`);
  if (o.wait === false) return { pid: child.pid, port };
  const t0 = Date.now();
  const timeout = o.timeoutMs ?? 240_000;
  while (Date.now() - t0 < timeout) {
    if (!pidAlive(child.pid)) {
      throw Object.assign(new Error('Server process exited during startup'), { hint: `See ${path.join(dir, 'logs', 'mcb-console.log')} (\`mcb server logs\`)` });
    }
    const ping = await pingServer('127.0.0.1', port, 2000);
    if (ping) {
      log(`server up: ${ping.version} on port ${port} (${Math.round((Date.now() - t0) / 1000)} s)`);
      await initWorld(dir, props, log).catch((e) => log(`note: world init skipped (${e.message})`));
      return { pid: child.pid, port, version: ping.version, startupMs: Date.now() - t0 };
    }
    await sleep(1500);
  }
  throw Object.assign(new Error(`Server did not come up within ${timeout / 1000} s`), { hint: '`mcb server logs` shows what it is doing.' });
}

/** One-time build-friendly world defaults (eternal noon, clear weather, no mobs) via RCON. */
async function initWorld(dir, props, log) {
  const flag = path.join(dir, '.mcb-world-initialized');
  if (fs.existsSync(flag) || props.get('enable-rcon') !== 'true') return;
  const client = new RconClient({ port: Number(props.get('rcon.port') ?? 25575), password: props.get('rcon.password') });
  await client.connect();
  try {
    const { getGamerule } = await import('../gamerules.js');
    const t = { kind: 'rcon', query: async (c) => ({ text: await client.command(c) }), command: async (c) => ({ text: await client.command(c) }) };
    for (const [key, val] of [['doDaylightCycle', 'false'], ['doWeatherCycle', 'false'], ['doMobSpawning', 'false']]) {
      const g = await getGamerule(t, key);
      if (g) await client.command(`gamerule ${g.name} ${val}`);
    }
    await client.command('time set noon');
    await client.command('weather clear');
    fs.writeFileSync(flag, new Date().toISOString());
    log('world defaults applied (noon, clear weather, no mob spawning)');
  } finally {
    client.close();
  }
}

export async function stopServer(o) {
  const log = o.log ?? (() => {});
  const dir = path.resolve(o.dir);
  const pid = readPid(dir);
  const props = readProperties(path.join(dir, 'server.properties'));
  if (props.get('enable-rcon') === 'true') {
    try {
      const client = new RconClient({ port: Number(props.get('rcon.port') ?? 25575), password: props.get('rcon.password'), timeoutMs: 5000 });
      await client.connect();
      await client.command('stop').catch(() => {});
      client.close();
      log('sent /stop via RCON');
    } catch (e) {
      log(`RCON stop failed (${e.message})`);
    }
  }
  if (pid) {
    const t0 = Date.now();
    while (pidAlive(pid) && Date.now() - t0 < 60_000) await sleep(500);
    if (pidAlive(pid)) {
      if (pidIsJava(pid) === true) {
        log('server still running after 60 s — terminating process');
        try { process.kill(pid); } catch { /* ignore */ }
      } else {
        log(`process ${pid} is still running but does not look like the server — not killing it`);
      }
    }
  }
  fs.rmSync(path.join(dir, PID_FILE), { force: true });
  return { stopped: true, pid };
}

export async function serverStatus(o) {
  const dir = o.dir ? path.resolve(o.dir) : null;
  const pid = dir ? readPid(dir) : null;
  const ping = await pingServer(o.host ?? '127.0.0.1', o.port ?? 25565);
  return { dir, pid, running: !!ping, ping };
}

export function tailLog(dir, lines = 40) {
  for (const f of [path.join(dir, 'logs', 'latest.log'), path.join(dir, 'logs', 'mcb-console.log')]) {
    if (fs.existsSync(f)) {
      const all = fs.readFileSync(f, 'utf8').split(/\r?\n/);
      return { file: f, lines: all.slice(-lines - 1) };
    }
  }
  return { file: null, lines: [] };
}
