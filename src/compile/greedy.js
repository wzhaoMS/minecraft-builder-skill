/**
 * Greedy box merging: turns a voxel Structure into a small set of axis-aligned boxes, each of a
 * single block state, so a build needs far fewer /fill commands than blocks.
 *
 * Works tile by tile (default 64×64 columns, full height) on a dense copy, extending each seed voxel
 * along X, then Z (whole rows), then Y (whole rectangles), never exceeding `maxVolume`
 * (the server's max_block_modifications / commandModificationBlockLimit, default 32768).
 */

/**
 * @typedef {{ x1:number, y1:number, z1:number, x2:number, y2:number, z2:number, id:number }} Box
 */

/**
 * @param {import('../core/structure.js').Structure} structure
 * @param {{ maxVolume?: number, tile?: number, ids?: Set<number>|null }} [opts]
 * @returns {Box[]}
 */
export function greedyBoxes(structure, { maxVolume = 32768, tile = 64, ids = null } = {}) {
  if (tile % 16 !== 0) throw new Error('tile must be a multiple of 16');
  const tiles = new Map(); // "tx,tz" → [{key, sec, sx, sy, sz}]
  for (const [key, sec] of structure._sections) {
    const sy = (key % 256) - 128;
    const rest = Math.floor(key / 256);
    const sz = (rest % 2 ** 18) - 2 ** 17;
    const sx = Math.floor(rest / 2 ** 18) - 2 ** 17;
    const tx = Math.floor((sx * 16) / tile), tz = Math.floor((sz * 16) / tile);
    const tk = tx + ',' + tz;
    if (!tiles.has(tk)) tiles.set(tk, { tx, tz, secs: [] });
    tiles.get(tk).secs.push({ sec, sx, sy, sz });
  }
  const boxes = [];
  const tileKeys = [...tiles.keys()].sort((a, b) => {
    const [ax, az] = a.split(',').map(Number), [bx, bz] = b.split(',').map(Number);
    return az - bz || ax - bx;
  });
  for (const tk of tileKeys) {
    const { tx, tz, secs } = tiles.get(tk);
    let minSy = Infinity, maxSy = -Infinity;
    for (const s of secs) { if (s.sy < minSy) minSy = s.sy; if (s.sy > maxSy) maxSy = s.sy; }
    const W = tile, D = tile, H = (maxSy - minSy + 1) * 16;
    const ox = tx * tile, oz = tz * tile, oy = minSy * 16;
    const grid = new Uint16Array(W * D * H);
    const idx = (x, y, z) => (y * D + z) * W + x;
    let any = false;
    for (const { sec, sx, sy, sz } of secs) {
      const bx = sx * 16 - ox, by = sy * 16 - oy, bz = sz * 16 - oz;
      for (let i = 0; i < 4096; i++) {
        const id = sec[i];
        if (id === 0 || (ids && !ids.has(id))) continue;
        grid[idx(bx + (i & 15), by + (i >> 8), bz + ((i >> 4) & 15))] = id;
        any = true;
      }
    }
    if (!any) continue;
    for (let y = 0; y < H; y++) {
      for (let z = 0; z < D; z++) {
        for (let x = 0; x < W; x++) {
          const id = grid[idx(x, y, z)];
          if (id === 0) continue;
          // extend along X
          let x2 = x;
          while (x2 + 1 < W && x2 - x + 2 <= maxVolume && grid[idx(x2 + 1, y, z)] === id) x2++;
          const dx = x2 - x + 1;
          // extend along Z (whole row must match)
          let z2 = z;
          while (z2 + 1 < D && dx * (z2 - z + 2) <= maxVolume) {
            let ok = true;
            for (let xx = x; xx <= x2; xx++) if (grid[idx(xx, y, z2 + 1)] !== id) { ok = false; break; }
            if (!ok) break;
            z2++;
          }
          const area = dx * (z2 - z + 1);
          // extend along Y (whole rectangle must match)
          let y2 = y;
          while (y2 + 1 < H && area * (y2 - y + 2) <= maxVolume) {
            let ok = true;
            for (let zz = z; zz <= z2 && ok; zz++) {
              for (let xx = x; xx <= x2; xx++) if (grid[idx(xx, y2 + 1, zz)] !== id) { ok = false; break; }
            }
            if (!ok) break;
            y2++;
          }
          for (let yy = y; yy <= y2; yy++) for (let zz = z; zz <= z2; zz++) for (let xx = x; xx <= x2; xx++) grid[idx(xx, yy, zz)] = 0;
          boxes.push({ x1: ox + x, y1: oy + y, z1: oz + z, x2: ox + x2, y2: oy + y2, z2: oz + z2, id });
        }
      }
    }
  }
  return boxes;
}

export const boxVolume = (b) => (b.x2 - b.x1 + 1) * (b.y2 - b.y1 + 1) * (b.z2 - b.z1 + 1);
