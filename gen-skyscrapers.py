#!/usr/bin/env python3
"""Generate detailed MC skyscraper schematics as Sponge .schem files."""
import gzip, struct, io, math, json

class SchemWriter:
    """Writes Sponge Schematic v2 .schem files."""
    def __init__(self, width, height, length):
        self.w, self.h, self.l = width, height, length
        self.blocks = {}  # (x,y,z) -> "minecraft:block_name"

    def set(self, x, y, z, block):
        if 0 <= x < self.w and 0 <= y < self.h and 0 <= z < self.l:
            self.blocks[(x, y, z)] = block

    def fill(self, x1, y1, z1, x2, y2, z2, block):
        for x in range(min(x1,x2), max(x1,x2)+1):
            for y in range(min(y1,y2), max(y1,y2)+1):
                for z in range(min(z1,z2), max(z1,z2)+1):
                    self.set(x, y, z, block)

    def save(self, filename):
        # Build palette
        palette = {"minecraft:air": 0}
        pid = 1
        for block in set(self.blocks.values()):
            if block not in palette:
                palette[block] = pid
                pid += 1

        # Build block data array (varint encoded)
        data = []
        for y in range(self.h):
            for z in range(self.l):
                for x in range(self.w):
                    block = self.blocks.get((x,y,z), "minecraft:air")
                    val = palette[block]
                    # Encode varint
                    while val > 0x7F:
                        data.append((val & 0x7F) | 0x80)
                        val >>= 7
                    data.append(val & 0x7F)

        block_data = bytes(data)

        # Write NBT
        buf = io.BytesIO()
        def write_byte(v): buf.write(struct.pack('>b', v))
        def write_short(v): buf.write(struct.pack('>h', v))
        def write_int(v): buf.write(struct.pack('>i', v))
        def write_string(s):
            b = s.encode('utf-8')
            write_short(len(b))
            buf.write(b)
        def write_tag_header(tag_type, name):
            write_byte(tag_type)
            write_string(name)

        # Root compound: "Schematic"
        write_tag_header(10, "Schematic")

        # Version (int)
        write_tag_header(3, "Version")
        write_int(2)

        # DataVersion (int) - 1.21.1
        write_tag_header(3, "DataVersion")
        write_int(3955)

        # Width (short)
        write_tag_header(2, "Width")
        write_short(self.w)

        # Height (short)
        write_tag_header(2, "Height")
        write_short(self.h)

        # Length (short)
        write_tag_header(2, "Length")
        write_short(self.l)

        # Palette compound
        write_tag_header(10, "Palette")
        for name, val in palette.items():
            write_tag_header(3, name)
            write_int(val)
        write_byte(0)  # End palette compound

        # PaletteMax (int)
        write_tag_header(3, "PaletteMax")
        write_int(len(palette))

        # BlockData (byte array)
        write_tag_header(7, "BlockData")
        write_int(len(block_data))
        buf.write(block_data)

        # Metadata compound (empty)
        write_tag_header(10, "Metadata")
        write_byte(0)

        # End root compound
        write_byte(0)

        # Write gzipped
        with gzip.open(filename, 'wb') as f:
            f.write(buf.getvalue())

def build_glass_tower(name, w, d, h, body, glass, accent, spire_h=15):
    """Modern glass skyscraper with curtain wall windows."""
    s = SchemWriter(w+4, h+spire_h+5, d+4)
    ox, oz = 2, 2  # offset for margin

    # Foundation
    s.fill(ox-1, 0, oz-1, ox+w, 0, oz+d, "minecraft:smooth_stone")

    # Lobby (floors 1-4) — glass + pillars
    for y in range(1, 5):
        for x in range(w):
            for z in range(d):
                if x == 0 or x == w-1 or z == 0 or z == d-1:
                    if (x == 0 or x == w-1) and (z == 0 or z == d-1):
                        s.set(ox+x, y, oz+z, f"minecraft:{body}")
                    elif y == 4:
                        s.set(ox+x, y, oz+z, f"minecraft:{accent}")
                    else:
                        s.set(ox+x, y, oz+z, "minecraft:glass")
                elif y == 1:
                    s.set(ox+x, y, oz+z, "minecraft:polished_deepslate")

    # Door opening
    s.set(ox+w//2, 1, oz, "minecraft:air")
    s.set(ox+w//2, 2, oz, "minecraft:air")
    s.set(ox+w//2, 3, oz, "minecraft:air")

    # Main tower body with window grid
    for y in range(5, h):
        floor_in_section = (y - 5) % 4
        for x in range(w):
            for z in range(d):
                is_edge = x == 0 or x == w-1 or z == 0 or z == d-1
                is_corner = (x == 0 or x == w-1) and (z == 0 or z == d-1)
                if not is_edge:
                    continue

                if is_corner:
                    s.set(ox+x, y, oz+z, f"minecraft:{body}")
                elif floor_in_section == 0:
                    # Floor slab line
                    s.set(ox+x, y, oz+z, f"minecraft:{accent}")
                elif floor_in_section == 3:
                    # Ceiling line
                    s.set(ox+x, y, oz+z, f"minecraft:{body}")
                else:
                    # Window rows — alternating glass and mullion
                    edge_pos = x if (z == 0 or z == d-1) else z
                    if edge_pos % 3 == 0:
                        s.set(ox+x, y, oz+z, f"minecraft:{body}")  # mullion
                    else:
                        s.set(ox+x, y, oz+z, f"minecraft:{glass}")

        # Floors every 4 blocks
        if floor_in_section == 0:
            s.fill(ox+1, y, oz+1, ox+w-2, y, oz+d-2, f"minecraft:{body}")

    # Roof
    s.fill(ox, h, oz, ox+w-1, h, oz+d-1, f"minecraft:{accent}")
    s.fill(ox+1, h+1, oz+1, ox+w-2, h+1, oz+d-2, f"minecraft:{body}")

    # Spire/antenna
    cx, cz = ox + w//2, oz + d//2
    for dy in range(spire_h):
        s.set(cx, h+2+dy, cz, f"minecraft:{accent}")
    # Beacon light at top
    s.set(cx, h+2+spire_h, cz, "minecraft:sea_lantern")

    return s

def build_setback_tower(name, base_w, base_d, h, body, glass, accent, tiers=4):
    """Art deco style tower with tiered setbacks."""
    s = SchemWriter(base_w+6, h+25, base_d+6)
    ox, oz = 3, 3

    # Foundation
    s.fill(ox-2, 0, oz-2, ox+base_w+1, 0, oz+base_d+1, "minecraft:smooth_stone")

    tier_h = h // tiers
    for tier in range(tiers):
        shrink = tier * 2
        tw = base_w - shrink
        td = base_d - shrink
        tx = ox + shrink // 2
        tz = oz + shrink // 2
        y_start = tier * tier_h + 1
        y_end = (tier + 1) * tier_h

        if tw < 3 or td < 3:
            break

        for y in range(y_start, y_end + 1):
            floor_mod = (y - y_start) % 4
            for x in range(tw):
                for z in range(td):
                    is_edge = x == 0 or x == tw-1 or z == 0 or z == td-1
                    is_corner = (x == 0 or x == tw-1) and (z == 0 or z == td-1)
                    if not is_edge:
                        continue
                    if is_corner:
                        s.set(tx+x, y, tz+z, f"minecraft:{body}")
                    elif floor_mod == 0:
                        s.set(tx+x, y, tz+z, f"minecraft:{accent}")
                    elif floor_mod == 3:
                        s.set(tx+x, y, tz+z, f"minecraft:{body}")
                    else:
                        edge_pos = x if (z == 0 or z == td-1) else z
                        if edge_pos % 2 == 0:
                            s.set(tx+x, y, tz+z, f"minecraft:{body}")
                        else:
                            s.set(tx+x, y, tz+z, f"minecraft:{glass}")

            # Floor slabs
            if floor_mod == 0:
                s.fill(tx+1, y, tz+1, tx+tw-2, y, tz+td-2, f"minecraft:{body}")

        # Setback ledge
        s.fill(tx-1, y_end+1, tz-1, tx+tw, y_end+1, tz+td, f"minecraft:{accent}")

    # Crown ornament
    top_y = h + 1
    cx, cz = ox + base_w//2, oz + base_d//2
    # Pinnacles at corners
    final_shrink = (tiers-1) * 2
    fx, fz = ox + final_shrink//2, oz + final_shrink//2
    fw = base_w - final_shrink
    fd = base_d - final_shrink
    for dx, dz in [(0,0), (fw-1,0), (0,fd-1), (fw-1,fd-1)]:
        for dy in range(8):
            s.set(fx+dx, top_y+dy, fz+dz, f"minecraft:{accent}")
    # Central spire
    for dy in range(20):
        s.set(cx, top_y+dy, cz, f"minecraft:{accent}")
    s.set(cx, top_y+20, cz, "minecraft:sea_lantern")

    return s

def build_cylinder_tower(name, radius, h, body, glass, accent, crown_h=8):
    """Cylindrical tower (like Shanghai Tower)."""
    diam = radius * 2 + 3
    s = SchemWriter(diam, h + crown_h + 15, diam)
    cx, cz = radius + 1, radius + 1

    # Foundation circle
    for x in range(diam):
        for z in range(diam):
            dx, dz = x - cx, z - cz
            if dx*dx + dz*dz <= (radius+1)**2:
                s.set(x, 0, z, "minecraft:smooth_stone")

    for y in range(1, h):
        floor_mod = y % 4
        r = radius
        # Slight taper toward top
        if y > h * 0.7:
            r = max(3, int(radius - (y - h*0.7) / (h*0.3) * 2))

        for x in range(diam):
            for z in range(diam):
                dx, dz = x - cx, z - cz
                dist = math.sqrt(dx*dx + dz*dz)
                if abs(dist - r) < 1.0:  # Shell
                    if floor_mod == 0:
                        s.set(x, y, z, f"minecraft:{accent}")
                    elif dist > r - 0.5:
                        # Outer ring — glass with mullions
                        angle = math.atan2(dz, dx)
                        mullion = int(angle * radius / 1.5) % 3 == 0
                        if mullion:
                            s.set(x, y, z, f"minecraft:{body}")
                        else:
                            s.set(x, y, z, f"minecraft:{glass}")
                    else:
                        s.set(x, y, z, f"minecraft:{body}")

        # Floor slabs
        if floor_mod == 0:
            for x in range(diam):
                for z in range(diam):
                    dx, dz = x - cx, z - cz
                    if dx*dx + dz*dz < (r-1)**2:
                        s.set(x, y, z, f"minecraft:{body}")

    # Crown
    for dy in range(crown_h):
        cr = max(2, radius - 2 - dy // 2)
        for x in range(diam):
            for z in range(diam):
                dx, dz = x - cx, z - cz
                dist = math.sqrt(dx*dx + dz*dz)
                if abs(dist - cr) < 1.0:
                    s.set(x, h+dy, z, "minecraft:sea_lantern" if dy == crown_h-1 else f"minecraft:{accent}")

    # Spire
    for dy in range(12):
        s.set(cx, h+crown_h+dy, cz, f"minecraft:{accent}")
    s.set(cx, h+crown_h+12, cz, "minecraft:sea_lantern")

    return s


# === Generate 3 impressive skyscrapers ===
print("Generating skyscrapers...")

# 1. Modern Glass Tower — like One World Trade Center
#    Blue glass curtain wall, 120 blocks tall
t1 = build_glass_tower("ModernGlassTower", 16, 16, 120,
    body="cyan_terracotta", glass="light_blue_stained_glass",
    accent="white_concrete", spire_h=18)
t1.save("/home/wei/Documents/mc-server/plugins/FastAsyncWorldEdit/schematics/ModernGlassTower.schem")
print("  ModernGlassTower: 16x120x16 + 18 spire")

# 2. Art Deco Setback Tower — like Empire State Building
#    Gray stone with gold accents, tiered setbacks, 100 blocks
t2 = build_setback_tower("ArtDecoTower", 20, 20, 100,
    body="gray_concrete", glass="white_stained_glass",
    accent="gold_block", tiers=5)
t2.save("/home/wei/Documents/mc-server/plugins/FastAsyncWorldEdit/schematics/ArtDecoTower.schem")
print("  ArtDecoTower: 20x100x20, 5 tiers + crown")

# 3. Cylindrical Glass Tower — like Shanghai Tower (twisted)
#    Blue-green glass, 110 blocks tall, cylindrical
t3 = build_cylinder_tower("CylinderTower", 8, 110,
    body="cyan_concrete", glass="light_blue_stained_glass",
    accent="white_concrete", crown_h=8)
t3.save("/home/wei/Documents/mc-server/plugins/FastAsyncWorldEdit/schematics/CylinderTower.schem")
print("  CylinderTower: r=8, h=110 + crown")

# 4. Dark Modern Tower — like Jin Mao / John Hancock
#    Dark with gold bands
t4 = build_setback_tower("DarkTower", 14, 14, 88,
    body="black_concrete", glass="gray_stained_glass",
    accent="gold_block", tiers=4)
t4.save("/home/wei/Documents/mc-server/plugins/FastAsyncWorldEdit/schematics/DarkTower.schem")
print("  DarkTower: 14x88x14, 4 tiers + gold bands")

# 5. Sleek Silver Tower
t5 = build_glass_tower("SilverTower", 12, 12, 95,
    body="light_gray_concrete", glass="white_stained_glass",
    accent="iron_block", spire_h=12)
t5.save("/home/wei/Documents/mc-server/plugins/FastAsyncWorldEdit/schematics/SilverTower.schem")
print("  SilverTower: 12x95x12 + spire")

print("\nAll 5 schematics saved!")
