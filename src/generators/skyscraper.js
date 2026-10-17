import { door, doubleDoor, finish } from './helpers.js';

/**
 * Skyscrapers — faithful ports of gen-skyscrapers.py (build_glass_tower, build_setback_tower,
 * build_cylinder_tower) with the entrance moved to the SOUTH face, a real door, and the lobby
 * floor at ground level.
 */
const STYLE_DEFAULTS = {
  glass: { body: 'cyan_terracotta', glass: 'light_blue_stained_glass', accent: 'white_concrete', spire: 18 },
  setback: { body: 'gray_concrete', glass: 'white_stained_glass', accent: 'gold_block', spire: 20 },
  cylinder: { body: 'cyan_concrete', glass: 'light_blue_stained_glass', accent: 'white_concrete', spire: 12 },
};

export default {
  name: 'skyscraper',
  description: 'Skyscraper: glass curtain-wall tower, art-deco setback tower or cylindrical tower; floors every 4 blocks',
  params: {
    style: { type: 'enum', values: ['glass', 'setback', 'cylinder'], default: 'glass', description: 'architecture' },
    width: { type: 'int', default: 16, min: 6, max: 64, description: 'width (glass / setback)' },
    depth: { type: 'int', default: 16, min: 6, max: 64, description: 'depth (glass / setback)' },
    height: { type: 'int', default: 96, min: 12, max: 360, description: 'height of the main body' },
    radius: { type: 'int', default: 8, min: 4, max: 32, description: 'radius (cylinder)' },
    body: { type: 'block', default: '', description: 'structure / mullions (style default when empty)' },
    glass: { type: 'block', default: '', description: 'window glass (style default when empty)' },
    accent: { type: 'block', default: '', description: 'floor bands, roof, spire (style default when empty)' },
    spire: { type: 'int', default: -1, min: -1, max: 64, description: 'spire height (-1 = style default, 0 = none)' },
    tiers: { type: 'int', default: 4, min: 1, max: 12, description: 'setback tiers' },
    crown: { type: 'int', default: 8, min: 0, max: 24, description: 'crown height (cylinder)' },
  },
  build(s, p) {
    const d = STYLE_DEFAULTS[p.style];
    const o = { ...p, body: p.body || d.body, glass: p.glass || d.glass, accent: p.accent || d.accent, spire: p.spire < 0 ? d.spire : p.spire };
    if (p.style === 'setback') setbackTower(s, o);
    else if (p.style === 'cylinder') cylinderTower(s, o);
    else glassTower(s, o);
    finish(s);
  },
};

function entrance(s, x0, x1, z, y = 1) {
  // centred single door (odd width) or double door (even width) with a transom above
  const w = x1 - x0 + 1;
  if (w % 2) door(s, x0 + (w - 1) / 2, y, z, { facing: 'south', material: 'dark_oak' });
  else doubleDoor(s, x0 + w / 2 - 1, y, z, { facing: 'south', material: 'dark_oak' });
}

/** build_glass_tower: lobby, curtain wall with mullions every 3, floors every 4, roof + spire. */
export function glassTower(s, { width: w, depth: d, height: h, body, glass, accent, spire }, ox = 0, oz = 0) {
  const S = (x, y, z, b) => s.set(ox + x, y, oz + z, b);
  s.fill(ox - 1, 0, oz - 1, ox + w, 0, oz + d, 'smooth_stone');
  // lobby
  for (let y = 1; y <= 4; y++) {
    for (let x = 0; x < w; x++) {
      for (let z = 0; z < d; z++) {
        const edge = x === 0 || x === w - 1 || z === 0 || z === d - 1;
        if (!edge) continue;
        const corner = (x === 0 || x === w - 1) && (z === 0 || z === d - 1);
        S(x, y, z, corner ? body : y === 4 ? accent : 'glass');
      }
    }
  }
  s.fill(ox + 1, 0, oz + 1, ox + w - 2, 0, oz + d - 2, 'polished_deepslate');
  entrance(s, ox + (w % 2 ? (w - 1) / 2 : w / 2 - 1), ox + (w % 2 ? (w - 1) / 2 : w / 2), oz + d - 1);
  // tower body
  for (let y = 5; y < h; y++) {
    const fis = (y - 5) % 4;
    for (let x = 0; x < w; x++) {
      for (let z = 0; z < d; z++) {
        const edge = x === 0 || x === w - 1 || z === 0 || z === d - 1;
        if (!edge) continue;
        const corner = (x === 0 || x === w - 1) && (z === 0 || z === d - 1);
        let b;
        if (corner) b = body;
        else if (fis === 0) b = accent;
        else if (fis === 3) b = body;
        else {
          const edgePos = z === 0 || z === d - 1 ? x : z;
          b = edgePos % 3 === 0 ? body : glass;
        }
        S(x, y, z, b);
      }
    }
    if (fis === 0) s.fill(ox + 1, y, oz + 1, ox + w - 2, y, oz + d - 2, body);
  }
  // roof
  s.fill(ox, h, oz, ox + w - 1, h, oz + d - 1, accent);
  s.fill(ox + 1, h + 1, oz + 1, ox + w - 2, h + 1, oz + d - 2, body);
  const cx = Math.floor(w / 2), cz = Math.floor(d / 2);
  if (spire > 0) {
    for (let dy = 0; dy < spire; dy++) S(cx, h + 2 + dy, cz, accent);
    S(cx, h + 2 + spire, cz, 'sea_lantern');
  }
  return s;
}

/** build_setback_tower: art-deco tiers shrinking 1 block per side, ledges, corner pinnacles and a spire. */
export function setbackTower(s, { width: bw, depth: bd, height: h, body, glass, accent, spire, tiers }, ox = 0, oz = 0) {
  const S = (x, y, z, b) => s.set(ox + x, y, oz + z, b);
  s.fill(ox - 2, 0, oz - 2, ox + bw + 1, 0, oz + bd + 1, 'smooth_stone');
  const tierH = Math.floor(h / tiers);
  let built = 0;
  for (let t = 0; t < tiers; t++) {
    const shrink = t * 2;
    const tw = bw - shrink, td = bd - shrink;
    const tx = shrink / 2, tz = shrink / 2;
    const ys = t * tierH + 1, ye = (t + 1) * tierH;
    if (tw < 3 || td < 3) break;
    built = t;
    for (let y = ys; y <= ye; y++) {
      const fm = (y - ys) % 4;
      for (let x = 0; x < tw; x++) {
        for (let z = 0; z < td; z++) {
          const edge = x === 0 || x === tw - 1 || z === 0 || z === td - 1;
          if (!edge) continue;
          const corner = (x === 0 || x === tw - 1) && (z === 0 || z === td - 1);
          let b;
          if (corner) b = body;
          else if (fm === 0) b = accent;
          else if (fm === 3) b = body;
          else {
            const edgePos = z === 0 || z === td - 1 ? x : z;
            b = edgePos % 2 === 0 ? body : glass;
          }
          S(tx + x, y, tz + z, b);
        }
      }
      if (fm === 0 && y > 1) s.fill(ox + tx + 1, y, oz + tz + 1, ox + tx + tw - 2, y, oz + tz + td - 2, body);
    }
    s.fill(ox + tx - 1, ye + 1, oz + tz - 1, ox + tx + tw, ye + 1, oz + tz + td, accent);
  }
  // lobby floor + entrance on the south face of the first tier
  s.fill(ox + 1, 0, oz + 1, ox + bw - 2, 0, oz + bd - 2, 'polished_deepslate');
  s.fill(ox + 1, 1, oz + bd - 1, ox + bw - 2, 3, oz + bd - 1, 'glass');
  entrance(s, ox + (bw % 2 ? (bw - 1) / 2 : bw / 2 - 1), ox + (bw % 2 ? (bw - 1) / 2 : bw / 2), oz + bd - 1);
  // crown
  const topY = h + 1;
  const cx = Math.floor(bw / 2), cz = Math.floor(bd / 2);
  const fs = built * 2;
  const fx = fs / 2, fz = fs / 2, fw = bw - fs, fd = bd - fs;
  for (const [dx, dz] of [[0, 0], [fw - 1, 0], [0, fd - 1], [fw - 1, fd - 1]]) {
    for (let dy = 0; dy < 8; dy++) S(fx + dx, topY + dy, fz + dz, accent);
  }
  if (spire > 0) {
    for (let dy = 0; dy < spire; dy++) S(cx, topY + dy, cz, accent);
    S(cx, topY + spire, cz, 'sea_lantern');
  }
  return s;
}

/** build_cylinder_tower: round glass tower tapering in its top 30 %, crown rings and a spire. */
export function cylinderTower(s, { radius, height: h, body, glass, accent, spire, crown }, ox = 0, oz = 0) {
  const diam = radius * 2 + 3;
  const cx = radius + 1, cz = radius + 1;
  const S = (x, y, z, b) => s.set(ox + x, y, oz + z, b);
  const pyMod = (n, m) => ((n % m) + m) % m;
  for (let x = 0; x < diam; x++) for (let z = 0; z < diam; z++) {
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz <= (radius + 1) ** 2) S(x, 0, z, 'smooth_stone');
  }
  for (let y = 1; y < h; y++) {
    const fm = y % 4;
    let r = radius;
    if (y > h * 0.7) r = Math.max(3, Math.trunc(radius - ((y - h * 0.7) / (h * 0.3)) * 2));
    for (let x = 0; x < diam; x++) {
      for (let z = 0; z < diam; z++) {
        const dx = x - cx, dz = z - cz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (Math.abs(dist - r) < 1.0) {
          if (fm === 0) S(x, y, z, accent);
          else if (dist > r - 0.5) {
            const angle = Math.atan2(dz, dx);
            const mullion = pyMod(Math.trunc((angle * radius) / 1.5), 3) === 0;
            S(x, y, z, mullion ? body : glass);
          } else S(x, y, z, body);
        }
      }
    }
    if (fm === 0) {
      for (let x = 0; x < diam; x++) for (let z = 0; z < diam; z++) {
        const dx = x - cx, dz = z - cz;
        if (dx * dx + dz * dz < (r - 1) ** 2) S(x, y, z, body);
      }
    }
  }
  // lobby floor + south entrance
  for (let x = 0; x < diam; x++) for (let z = 0; z < diam; z++) {
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz < (radius - 1) ** 2) S(x, 0, z, 'polished_deepslate');
  }
  // the shell is two blocks thick on the axis: open the inner one, door in the outer one
  S(cx, 1, cz + radius - 1, 'air'); S(cx, 2, cz + radius - 1, 'air');
  door(s, ox + cx, 1, oz + cz + radius, { facing: 'south', material: 'dark_oak' });
  for (let dy = 0; dy < crown; dy++) {
    const cr = Math.max(2, radius - 2 - Math.floor(dy / 2));
    for (let x = 0; x < diam; x++) for (let z = 0; z < diam; z++) {
      const dx = x - cx, dz = z - cz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (Math.abs(dist - cr) < 1.0) S(x, h + dy, z, dy === crown - 1 ? 'sea_lantern' : accent);
    }
  }
  if (spire > 0) {
    for (let dy = 0; dy < spire; dy++) S(cx, h + crown + dy, cz, accent);
    S(cx, h + crown + spire, cz, 'sea_lantern');
  }
  return s;
}
