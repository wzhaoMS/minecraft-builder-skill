/**
 * Downloads: Paper (PaperMC "fill" v3 API — the old api.papermc.io/v2 returns 410 Gone),
 * FastAsyncWorldEdit (Modrinth), Temurin Java (Adoptium). All verified by checksum.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const USER_AGENT = 'minecraft-builder-skill/2 (https://github.com/wzhaoMS/minecraft-builder-skill)';
export const DEFAULT_MC_VERSION = '1.21.11';

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.json();
}

/** Download to `dest` (atomically via .part) and verify a sha256/sha512 hex digest. */
export async function download(url, dest, { sha256, sha512, onProgress } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`Download failed: ${url} → HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const algo = sha512 ? 'sha512' : 'sha256';
  const hash = crypto.createHash(algo);
  let got = 0;
  const part = dest + '.part';
  const src = Readable.fromWeb(res.body);
  src.on('data', (chunk) => {
    hash.update(chunk);
    got += chunk.length;
    onProgress?.(got, total);
  });
  await pipeline(src, fs.createWriteStream(part));
  const digest = hash.digest('hex');
  const want = (sha512 ?? sha256)?.toLowerCase();
  if (want && digest !== want) {
    fs.rmSync(part, { force: true });
    throw new Error(`Checksum mismatch for ${path.basename(dest)} (expected ${want.slice(0, 12)}…, got ${digest.slice(0, 12)}…)`);
  }
  fs.renameSync(part, dest);
  return { file: dest, bytes: got, [algo]: digest };
}

/** Latest STABLE Paper build for a Minecraft version: { version, build, url, sha256, name, javaMin } */
export async function resolvePaper(mcVersion = DEFAULT_MC_VERSION) {
  const base = 'https://fill.papermc.io/v3/projects/paper';
  let info;
  try {
    info = await getJson(`${base}/versions/${mcVersion}`);
  } catch (e) {
    const proj = await getJson(base).catch(() => null);
    const all = proj ? Object.values(proj.versions).flat().filter((v) => !/-(pre|rc)/.test(v)).slice(0, 12) : [];
    throw new Error(`Paper has no version "${mcVersion}" (${e.message}).` + (all.length ? ` Available: ${all.join(', ')}` : ''));
  }
  const builds = await getJson(`${base}/versions/${mcVersion}/builds`);
  const list = Array.isArray(builds) ? builds : builds.builds ?? [];
  const stable = list.filter((b) => (b.channel ?? '').toUpperCase() === 'STABLE');
  const pick = (stable.length ? stable : list).sort((a, b) => b.id - a.id)[0];
  if (!pick) throw new Error(`No Paper builds for ${mcVersion}`);
  const d = pick.downloads?.['server:default'];
  if (!d?.url) throw new Error(`Paper build ${pick.id} has no server download`);
  return {
    version: mcVersion,
    build: pick.id,
    channel: pick.channel,
    url: d.url,
    sha256: d.checksums?.sha256,
    name: d.name,
    javaMin: info?.version?.java?.version?.minimum ?? 21,
  };
}

/** Latest FastAsyncWorldEdit (Paper) for a Minecraft version from Modrinth. */
export async function resolveFawe(mcVersion = DEFAULT_MC_VERSION) {
  const q = new URLSearchParams({ game_versions: JSON.stringify([mcVersion]), loaders: JSON.stringify(['paper']) });
  const versions = await getJson(`https://api.modrinth.com/v2/project/fastasyncworldedit/version?${q}`);
  const v = versions.find((x) => x.version_type === 'release') ?? versions[0];
  if (!v) throw new Error(`No FastAsyncWorldEdit release for Minecraft ${mcVersion}`);
  const f = v.files.find((x) => x.primary) ?? v.files[0];
  return { version: v.version_number, url: f.url, sha512: f.hashes?.sha512, name: f.filename };
}

/** Temurin JRE download for this OS/arch. */
export async function resolveJava(feature = 21) {
  const os = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform];
  const arch = { x64: 'x64', arm64: 'aarch64' }[process.arch];
  if (!os || !arch) throw new Error(`No automatic Java download for ${process.platform}/${process.arch}`);
  const list = await getJson(`https://api.adoptium.net/v3/assets/latest/${feature}/hotspot?architecture=${arch}&image_type=jre&os=${os}&vendor=eclipse`);
  const pkg = list?.[0]?.binary?.package;
  if (!pkg) throw new Error(`Adoptium has no Java ${feature} JRE for ${os}/${arch}`);
  return { url: pkg.link, sha256: pkg.checksum, name: pkg.name, release: list[0].release_name };
}
