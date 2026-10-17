/**
 * Blueprint linting: block validation against minecraft-data, automatic completion of two-block
 * objects (doors, beds, tall plants) and support warnings (torches, ladders, gravity blocks…).
 */
import { parseBlock, formatBlock, blockName, isAir } from './blockstate.js';
import { validateBlockState, twoBlockInfo, isGravityBlock, DEFAULT_MC_VERSION } from './blockinfo.js';

const DIRS = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };

function pushExample(map, key, msg, pos) {
  let e = map.get(key);
  if (!e) { e = { message: msg, count: 0, examples: [] }; map.set(key, e); }
  e.count++;
  if (e.examples.length < 3) e.examples.push(pos);
}

/**
 * @param {import('./structure.js').Structure} s
 * @param {{ version?: string, fix?: boolean }} [opts]
 * @returns {{ errors: object[], warnings: object[], fixes: object[], ok: boolean }}
 */
export function lintStructure(s, { version = DEFAULT_MC_VERSION, fix = true } = {}) {
  const errors = [];
  const warnings = new Map();
  const fixes = new Map();

  // 1. validate palette
  const counts = new Array(s.palette.length).fill(0);
  const firstPos = new Array(s.palette.length);
  s.forEach((x, y, z, b, id) => { counts[id]++; if (!firstPos[id]) firstPos[id] = [x, y, z]; });
  for (let id = 1; id < s.palette.length; id++) {
    if (!counts[id]) continue;
    const b = s.palette[id];
    const r = validateBlockState(parseBlock(b), version);
    if (!r.ok) errors.push({ block: b, count: counts[id], at: firstPos[id], errors: r.errors, suggestions: r.suggestions });
  }

  // 2. two-block completion + support checks
  const bounds = s.bounds();
  const groundY = bounds ? bounds.min[1] : 0;
  const todo = [];
  s.forEach((x, y, z, b) => {
    if (isAir(b)) return;
    const name = blockName(b);
    const info = twoBlockInfo(b);
    if (info) todo.push([x, y, z, b, info]);
    else checkSupport(s, x, y, z, b, name, groundY, warnings);
    if (isGravityBlock(b) && y > groundY) {
      const below = s.get(x, y - 1, z);
      if (below == null || isAir(below)) pushExample(warnings, 'gravity', `Gravity block (${name}) without a block below — it will fall`, [x, y, z]);
    }
  });
  for (const [x, y, z, b, info] of todo) {
    const cur = s.get(x, y, z);
    if (cur !== b) continue; // already rewritten by a previous fix
    const p = parseBlock(b);
    if (info.axis === 'y') {
      const half = p.props[info.prop];
      if (!half) {
        const above = s.get(x, y + 1, z);
        const below = s.get(x, y - 1, z);
        if (below && blockName(below) === p.name && !parseBlock(below).props[info.prop]) continue; // handled as upper of the one below
        if (!fix) { pushExample(warnings, 'half-' + p.name, `${p.name} without "${info.prop}" — needs ${info.lower}+${info.upper} halves`, [x, y, z]); continue; }
        const lower = formatBlock({ ...p, props: { ...p.props, [info.prop]: info.lower } });
        const upperProps = { ...p.props, [info.prop]: info.upper };
        if (above && blockName(above) === p.name) Object.assign(upperProps, parseBlock(above).props, { [info.prop]: info.upper });
        const upper = formatBlock({ ...p, props: upperProps });
        // A two-block-tall object always owns the cell above (a door drawn into a wall means a doorway).
        s.set(x, y, z, lower);
        s.set(x, y + 1, z, upper);
        if (above == null || isAir(above) || blockName(above) === p.name) {
          pushExample(fixes, 'half-' + p.name, `Completed ${p.name} as lower+upper halves`, [x, y, z]);
        } else {
          pushExample(fixes, 'carve-' + p.name, `Completed ${p.name} (replaced ${blockName(above)} above it with the upper half)`, [x, y, z]);
        }
      } else if (half === info.lower) {
        const above = s.get(x, y + 1, z);
        if (!above || blockName(above) !== p.name) {
          if (fix) {
            s.set(x, y + 1, z, formatBlock({ ...p, props: { ...p.props, [info.prop]: info.upper } }));
            pushExample(fixes, 'upper-' + p.name, `Added missing upper half of ${p.name}${above && !isAir(above) ? ` (replacing ${blockName(above)})` : ''}`, [x, y, z]);
          } else pushExample(warnings, 'upper-' + p.name, `${p.name} lower half without upper half above`, [x, y, z]);
        }
      } else if (half === info.upper) {
        const below = s.get(x, y - 1, z);
        if (!below || blockName(below) !== p.name) pushExample(warnings, 'lower-' + p.name, `${p.name} upper half without lower half below`, [x, y, z]);
      }
    } else {
      // beds: foot + head in the facing direction
      const facing = p.props.facing ?? 'north';
      const d = DIRS[facing] ?? DIRS.north;
      const part = p.props[info.prop];
      if (!part || part === info.lower) {
        const hx = x + d[0], hz = z + d[2];
        const head = s.get(hx, y, hz);
        if (!head || blockName(head) !== p.name || parseBlock(head).props.part !== info.upper) {
          if (fix && (head == null || isAir(head) || (blockName(head) === p.name && !parseBlock(head).props.part))) {
            s.set(x, y, z, formatBlock({ ...p, props: { ...p.props, facing, [info.prop]: info.lower } }));
            s.set(hx, y, hz, formatBlock({ ...p, props: { ...p.props, facing, [info.prop]: info.upper } }));
            pushExample(fixes, 'bed-' + p.name, `Completed ${p.name} with its head (facing ${facing})`, [x, y, z]);
          } else if (!part) pushExample(warnings, 'bed-' + p.name, `${p.name} has no room for its head`, [x, y, z]);
        }
      }
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings: [...warnings.values()],
    fixes: [...fixes.values()],
  };
}

function solidAt(s, x, y, z) {
  const b = s.get(x, y, z);
  return b != null && !isAir(b);
}

function checkSupport(s, x, y, z, b, name, groundY, warnings) {
  const p = parseBlock(b);
  const at = [x, y, z];
  const supportedBy = (dir) => {
    const d = DIRS[dir];
    const nx = x + d[0], ny = y + d[1], nz = z + d[2];
    if (dir === 'down' && ny < groundY) return true; // sits on the world's ground
    if (solidAt(s, nx, ny, nz)) return true;
    // Untouched neighbours might be existing terrain, but explicit air never supports.
    const nb = s.get(nx, ny, nz);
    return nb == null && dir === 'down' && ny === groundY - 1;
  };
  let need = null;
  if (/wall_torch$|_wall_sign$|_wall_banner$|^ladder$|wall_hanging_sign$|_wall_fan$|wall_skull$|wall_head$/.test(name)) {
    if (/wall_hanging_sign$/.test(name)) return;
    need = OPP[p.props.facing ?? 'north'];
  } else if (/^(torch|soul_torch|redstone_torch|copper_torch)$/.test(name) || /carpet$/.test(name) || /pressure_plate$/.test(name) ||
             /^(rail|powered_rail|detector_rail|activator_rail|redstone_wire|repeater|comparator|snow)$/.test(name) ||
             /(sapling|_flower|tulip|^poppy|^dandelion|^short_grass|^fern|bush$|^wheat|^carrots|^potatoes|_sign)$/.test(name) && !/hanging_sign$/.test(name)) {
    need = 'down';
  } else if (/lantern$/.test(name) && !/jack_o_lantern|sea_lantern/.test(name)) {
    need = p.props.hanging === 'true' ? 'up' : 'down';
  } else if (/_button$|^lever$/.test(name)) {
    const face = p.props.face ?? 'wall';
    need = face === 'floor' ? 'down' : face === 'ceiling' ? 'up' : OPP[p.props.facing ?? 'north'];
  }
  if (!need) return;
  if (!supportedBy(need)) {
    pushExample(warnings, 'support-' + name, `${name} needs a supporting block ${need === 'down' ? 'below' : need === 'up' ? 'above' : 'to the ' + need} — it may pop off`, at);
  }
}
