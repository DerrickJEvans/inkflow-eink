"""
Determine the correct board orientation and port mapping from the STEP file.
We need to figure out which STEP axis maps to the physical board layout.
"""
import re

stp_file = "raspberry_pi_5.stp"

# From the STEP extraction, the assembly transform is (-70.5, -36.0, 11.75)
# The board PCB geometry spans X: -70.5 to 0.068 ≈ 70.5mm (should be 85)
# and Y: -36.0 to 0.052 ≈ 36mm (should be 56)

# This means the PCB entities in the range #33972-#34241 show LOCAL coordinates
# of the PCB part, which are then placed into the assembly via the transform.

# But wait - the PCB in local coords spans only 70.5 x 36 mm, not 85 x 56.
# That seems wrong. Let me look more carefully at what the PCB entity contains.

# Actually, the #33972 PCB PRODUCT entity is followed by geometry up to #34241 (RAM).
# But the PCB actual SHAPE geometry (B-Rep faces) may be elsewhere in the file.
# Let's search for CLOSED_SHELL or MANIFOLD_SOLID_BREP linked to the PCB.

# Better approach: Instead of trying to decompose the complex STEP assembly hierarchy,
# let's find the PCB outline directly by looking for the board edge coordinates.
# The board is 85x56mm. Let's find all points that form a rectangle of those dimensions.

# From the common transform: (-70.5, -36.0, 11.75), the board goes:
# X: -70.5 to 14.5 = 85mm ✓
# Y: -36.0 to 20.0 = 56mm ✓
# So the board IS 85x56, just the local PCB entity only shows part of it.

# The assembly coordinates are:
# Board corner (0,0,0) physical = (-70.5, -36.0, Z_pcb_top) in STEP

# Now, the key question: Which corner is (-70.5, -36.0)?
# From the Pi 5 datasheet:
#   - USB-C is at X≈11.2 from left edge on the bottom edge
#   - Ethernet is at Y≈10.25 from bottom edge on the right edge
# 
# Let's check the USB-C placement: STEP origin (-31.330, -26.042, 1.600)
# Relative to board corner (-70.5, -36.0):
#   USB-C at board X = -31.330 - (-70.5) = 39.17
#   USB-C at board Y = -26.042 - (-36.0) = 9.96
#
# If this were the standard orientation (bottom-left origin, USB-C near left on bottom edge):
#   USB-C should be at (11.2, ~0) — but we get (39.17, 9.96)
#
# If board is ROTATED 180°:
#   USB-C would be at (85-39.17, 56-9.96) = (45.83, 46.04) — still wrong
#
# If board X and Y are SWAPPED (board is oriented differently):
#   USB-C at (9.96, 39.17) — Y=9.96 is near bottom edge, X=39.17 is mid-board
#   
# Hmm. Let me check Ethernet too.
# Ethernet: STEP (45.5, -17.85, 8.35) -> Board (116.0, 18.15)
# That puts it at X=116, well beyond the 85mm board! 
# This means the Ethernet position at step_x=45.5 is NOT using the same transform.

# Looking again at the transforms:
# - Most components use transform (-70.5, -36.0, 11.75) - this is assembly-level
# - Ethernet has its OWN transform: (45.5, -17.85, 8.35) - component level
# - USB has its OWN transform: (45.5, 19.05, 1.6) - component level
# - USB-C has (−31.33, −26.042, 1.6)
# - HDMI 0 has (-3.3, -26.788, 1.6)
# - HDMI 1 has (-16.7, -26.788, 1.6)

# These component-level transforms are RELATIVE TO THE ASSEMBLY, not to the board corner.
# The assembly-level transform (-70.5, -36.0, 11.75) positions the entire PCB into the 
# world coordinate system.

# So the components' STEP transforms are their positions in the ASSEMBLY coordinate system,
# which has its origin at the assembly origin (not the PCB corner).

# The assembly origin appears to be at the centre of the board or at some reference point.
# The PCB corners in assembly coords:
#   Corner 1: (-70.5, -36.0) 
#   Corner 2: (-70.5 + 85, -36.0 + 56) = (14.5, 20.0)

# Wait - the assembly transform IS the offset from assembly origin to board corner.
# Most components are placed relative to the board/assembly, not the world origin.

# Actually, the ITEM_DEFINED_TRANSFORMATION places a child part relative to its parent.
# The common transform (-70.5, -36.0, 11.75) places the board into the world.
# The component-specific transforms place components relative to THEIR parent 
# (which is the board assembly).

# So for components with their own transforms:
# USB-C at (-31.33, -26.042, 1.6) RELATIVE TO THE BOARD ASSEMBLY
# But the board assembly origin is at (-70.5, -36.0, 11.75)

# The component transforms are the TOTAL placement in world coords, or relative?
# Let's check: Ethernet at (45.5, -17.85, 8.35)
# If relative to assembly origin, board position = ?
# If relative to world origin, board position = (45.5-(-70.5), -17.85-(-36.0)) = (116, 18.15) -> too big

# Since Ethernet goes beyond the board edge, these positions must be relative to a 
# different reference. Let me look at it differently.

# Actually, the parts might be in LOCAL part coordinates, and the transform converts
# from local to assembly. Let me look at Ethernet more carefully.
# GIGABIT_ETHERNET: transform origin is (45.5, -17.85, 8.35)
# This means: the Ethernet part origin (0,0,0) is placed at (45.5, -17.85, 8.35) in assembly coords.

# If the assembly has the board going from (-70.5, -36.0) to (14.5, 20.0):
# Ethernet at assembly (45.5, -17.85) would be at board position:
#   X = 45.5 - (-70.5) = 116.0 — WAY past the board
# That's wrong. So the assembly transform is NOT from assembly to world.

# Let me reconsider. Perhaps:
# - The world origin is somewhere specific
# - Board is placed at (-70.5, -36.0, 11.75) in world
# - Components are placed ALSO in world coordinates (not relative to board)

# In that case, the USB-C at (-31.33, -26.04) in world coords:
# Board-relative: (-31.33 - (-70.5), -26.04 - (-36.0)) = (39.17, 9.96) 
# Same as before.

# And Ethernet at (45.5, -17.85) in world:
# Board-relative: (45.5 - (-70.5), -17.85 - (-36.0)) = (116.0, 18.15)
# Still 116, which is > 85mm board length!

# UNLESS the Ethernet transform is a COMPOSITION with the board transform:
# Total position = assembly_transform + component_transform
# Ethernet: (-70.5+45.5, -36.0+(-17.85)) = (-25.0, -53.85) — nonsense

# OR the component transforms are relative to the assembly origin (world origin):
# Ethernet at world (45.5, -17.85)
# And the board extends from world X = approx_world_board_left to +85

# Let me check: what is the ACTUAL X range of the Ethernet geometry in world coords?
# From our extraction: GIGABIT_ETHERNET geometry X: -0.05 to 45.50, Y: -17.85 to 0.00
# That's LOCAL geometry extending from (0,0) to (45.5, -17.85)

# Ah wait! The Ethernet geometry extent is 45.5mm wide and 17.85mm tall - those are
# the LOCAL dimensions of the Ethernet connector model. The placement transform 
# (45.5, -17.85, 8.35) puts the connector's local origin (0,0,0) at 
# board coordinates (45.5+(-70.5), -17.85+(-36.0)) — no that gives negative values.

# I think the issue is that these transforms are COMPOUNDED.
# The assembly has a world placement, then each sub-assembly has a relative placement.

# Let me try: the board's world transform is (-70.5, -36.0, 11.75)
# The Ethernet's placement relative to board is (45.5, -17.85, 8.35)
# World position of Ethernet origin = (-70.5 + 45.5, -36.0 + (-17.85)) = (-25.0, -53.85)
# In board-relative: (45.5, -17.85) — but board goes from 0 to 85 in X, 0 to 56 in Y
# So Ethernet at X=45.5 is mid-board on X, Y=-17.85 is BELOW the board!

# Hmm, Y=-17.85 being negative means it's at Y=36.0-17.85 = 18.15 from the bottom?
# If we consider the board reference origin is at the TOP-LEFT instead of bottom-left...
# Board top-left = (0, 0), Y increases downward, X increases rightward:
# Then Ethernet at (45.5, 17.85) relative to top-left
# Converting to bottom-left: (45.5, 56-17.85) = (45.5, 38.15) — still not right

# Let me try another approach. The official Pi 5 mechanical drawing says:
# - Board is 85 x 56mm
# - Mounting holes at (3.5, 3.5), (61.5, 3.5), (3.5, 52.5), (61.5, 52.5)
# - These are 58mm apart in X, 49mm apart in Y
#
# Let's find the mounting holes in the STEP file to establish the coordinate mapping!
print("Looking for mounting hole geometry in STEP file...")
print()

# Parse mounting hole geometry
# MOUNTING-HOLES_ASM is at #17224, with GROUND entries being the hole standoffs
# GROUND-1426 to GROUND-1429 are the 4 mounting holes

# From the first pass, GROUND entries had very small local geometry
# Let's look for CIRCLE entities (mounting holes are circular) near the mounting hole IDs

circles = {}
with open(stp_file, 'r') as f:
    for line in f:
        line = line.strip()
        # Look for CIRCLE entities
        m = re.match(r"#(\d+)=CIRCLE\('',#(\d+),([^)]+)\);", line)
        if m:
            eid = int(m.group(1))
            axis_ref = int(m.group(2))
            radius = float(m.group(3))
            circles[eid] = (axis_ref, radius)

# Find circles with radius matching M2.5 holes (radius ≈ 1.375mm)
# or standoff posts (radius ≈ 3mm)
print("Circles matching mounting hole size (r ~ 1.25-1.5mm):")
cartesian_points_cache = {}

# Re-read the file to get all cartesian points and axis placements
axis2_all = {}
cartesian_all = {}

with open(stp_file, 'r') as f:
    for line in f:
        line = line.strip()
        m = re.match(r"#(\d+)=CARTESIAN_POINT\('',\(([^)]+)\)\);", line)
        if m:
            eid = int(m.group(1))
            coords = []
            for c in m.group(2).split(','):
                try: coords.append(float(c.strip()))
                except: pass
            if len(coords) >= 3:
                cartesian_all[eid] = coords[:3]
            continue
        
        m = re.match(r"#(\d+)=AXIS2_PLACEMENT_3D\('',#(\d+),", line)
        if m:
            axis2_all[int(m.group(1))] = int(m.group(2))

# Find mounting hole circles and their positions
mounting_candidates = []
for cid, (axis_ref, radius) in circles.items():
    # M2.5 through-hole ≈ 1.375mm radius, or post ≈ 3mm radius
    if 1.2 <= radius <= 1.5:
        if axis_ref in axis2_all:
            pt_ref = axis2_all[axis_ref]
            if pt_ref in cartesian_all:
                pos = cartesian_all[pt_ref]
                mounting_candidates.append((cid, radius, pos))

print(f"\nFound {len(mounting_candidates)} potential mounting hole circles:")
# Filter unique positions (within 0.5mm tolerance)
unique_positions = []
for cid, r, pos in mounting_candidates:
    is_dup = False
    for _, _, existing in unique_positions:
        if all(abs(pos[i]-existing[i]) < 0.5 for i in range(3)):
            is_dup = True
            break
    if not is_dup:
        unique_positions.append((cid, r, pos))
        print(f"  Circle #{cid}: r={r:.3f}mm at ({pos[0]:.3f}, {pos[1]:.3f}, {pos[2]:.3f})")

# Now look for the 4-hole pattern
print(f"\nTotal unique mounting hole positions: {len(unique_positions)}")
print("\nLooking for 4-hole rectangular pattern (58mm x 49mm)...")

# Try all combinations of 4 holes
from itertools import combinations
for combo in combinations(unique_positions, 4):
    xs = sorted(set([round(p[2][0], 1) for p in combo]))
    ys = sorted(set([round(p[2][1], 1) for p in combo]))
    if len(xs) == 2 and len(ys) == 2:
        dx = xs[1] - xs[0]
        dy = ys[1] - ys[0]
        if 57 <= dx <= 59 and 48 <= dy <= 50:
            print(f"  FOUND! Holes at X={xs}, Y={ys}")
            print(f"  Spacing: {dx:.1f} x {dy:.1f} mm")
            print(f"  Board corner (3.5mm from holes):")
            board_x0 = xs[0] - 3.5
            board_y0 = ys[0] - 3.5
            print(f"    Board origin: ({board_x0:.1f}, {board_y0:.1f})")
            print(f"    Board end: ({board_x0+85:.1f}, {board_y0+56:.1f})")
            
            # Now recalculate all port positions relative to this origin
            print(f"\n  PORT POSITIONS (from board corner at ({board_x0:.1f}, {board_y0:.1f})):")
            
            placements = [
                ("USB-C Power",           -31.330, -26.042),
                ("Micro HDMI 0",           -3.300, -26.788),
                ("Micro HDMI 1",          -16.700, -26.788),
                ("Ethernet RJ45",          45.500, -17.850),
                ("USB 3.0 Ports",          36.470,   0.950),
                ("USB 2.0 Ports",          45.500,  19.050),
                ("SD Card Slot",          -34.500,   0.050),
                ("Power Button",          -42.000,  -9.450),
                ("Fan Header",            -39.550,   2.050),
                ("WiFi Module",           -30.300,  14.700),
                ("IR Sensor",             -40.700, -14.750),
                ("CSI/DSI 0",              11.750, -18.850),
                ("CSI/DSI 1",               5.250, -18.850),
            ]
            
            for pname, px, py in placements:
                bx = px - board_x0
                by = py - board_y0
                print(f"    {pname:<25} board ({bx:.2f}, {by:.2f})")
