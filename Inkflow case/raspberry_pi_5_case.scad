// ============================================================
// Raspberry Pi 5 Enclosure — Parametric OpenSCAD Design
// For 3D Printing (FDM / SLA compatible)
// ============================================================
//
// Dimensions sourced from:
//   - Official RPi 5 Mechanical Drawing (RP-008347-DS-1)
//   - Official STEP file: raspberry_pi_5.stp (Creo Parametric)
//   - Board verified: 85mm × 56mm, mounting holes 58×49mm pattern
//
// STEP file confirms:
//   - Board: 85 × 56 mm (standard Pi form factor)
//   - 4 mounting holes (M2.5) at 3.5mm inset, 58×49mm spacing
//   - Named components: PCB, USB-C, HDMI, Ethernet, USB3, USB2,
//     SD Card, GPIO, PoE, Power Button, UART, CSI/DSI, Fan
//   - NO 3.5mm audio jack (confirmed absent from STEP)
//   - PCIe FFC connector present on left edge
//
// ============================================================

/* [Rendering Quality] */
$fn = 60; // Set to 120+ for final STL export

/* [Case Design] */
wall_thickness    = 2.0;   // Wall thickness (mm)
floor_thickness   = 1.6;   // Bottom floor thickness
lid_thickness     = 1.6;   // Top lid thickness  
case_clearance    = 0.5;   // Clearance around board edges
corner_radius     = 3.0;   // External corner rounding
snap_tolerance    = 0.2;   // Lid snap-fit tolerance (tune for printer)
port_clearance    = 0.8;   // Extra clearance around port cutouts

/* [Board Dimensions — RPi 5] */
board_length      = 85.0;  // X axis
board_width       = 56.0;  // Y axis  
board_thickness   = 1.4;   // PCB thickness
board_standoff    = 3.5;   // Gap from case floor to PCB underside

/* [Mounting Holes — M2.5] */
// Verified from STEP: 58mm × 49mm spacing, 3.5mm from edges
mount_hole_dia    = 2.75;  // M2.5 + clearance
mount_post_dia    = 6.0;   // Standoff outer diameter
mount_positions   = [      // [x, y] from board bottom-left
    [3.5,  3.5 ],          // Bottom-left
    [61.5, 3.5 ],          // Bottom-right  
    [3.5,  52.5],          // Top-left
    [61.5, 52.5]           // Top-right
];

/* [Port Heights] */
tallest_port_h    = 16.0;  // USB-A / Ethernet stacked connectors
component_clear   = 1.5;   // Extra headroom above tallest component

// ============================================================
// COMPUTED DIMENSIONS
// ============================================================

inner_length = board_length + 2 * case_clearance;
inner_width  = board_width  + 2 * case_clearance;

// Bottom case height: floor + standoff + PCB + tallest port + clearance
inner_height = board_standoff + board_thickness + tallest_port_h + component_clear;

ext_length = inner_length + 2 * wall_thickness;
ext_width  = inner_width  + 2 * wall_thickness;
ext_height_bottom = inner_height + floor_thickness;

// Board reference offsets inside case
board_x_off = wall_thickness + case_clearance;
board_y_off = wall_thickness + case_clearance;
board_z_pcb_top = floor_thickness + board_standoff + board_thickness;

// Lid alignment lip
lip_height = 2.0;
lip_width  = 1.2;

// ============================================================
// PORT POSITIONS & CUTOUT SIZES
// ============================================================
// All positions from official mechanical drawing (RP-008347-DS-1)
// X/Y = centre of port from board bottom-left corner
// Cutout sizes include port_clearance
//
// Pi 5 layout (looking at board from above):
//   Bottom edge (Y=0): USB-C power, 2× micro HDMI
//   Right edge (X=85): Ethernet, USB 3.0 (×2 stacked), USB 2.0 (×2 stacked) 
//   Left edge (X=0):   microSD (underside), PCIe FFC
//   Top edge (Y=56):   40-pin GPIO header
//   On-board:          Power button, Fan connector, CSI/DSI×2, UART
// ============================================================

// --- BOTTOM EDGE (Y=0 wall) ---

// USB-C Power connector
usbc_cx = 11.2;                          // Centre X from left
usbc_w  = 9.0  + port_clearance;         // Cutout width
usbc_h  = 3.5  + port_clearance;         // Cutout height
usbc_z  = 1.65;                          // Centre Z above PCB top

// Micro HDMI 0 (nearest USB-C)
hdmi0_cx = 26.0;
hdmi0_w  = 7.5  + port_clearance;
hdmi0_h  = 3.5  + port_clearance;
hdmi0_z  = 2.0;

// Micro HDMI 1
hdmi1_cx = 39.5;
hdmi1_w  = 7.5  + port_clearance;
hdmi1_h  = 3.5  + port_clearance;
hdmi1_z  = 2.0;

// --- RIGHT EDGE (X=85 wall) ---

// Ethernet RJ45 (nearest to bottom edge on Pi 5)
eth_cy  = 10.25;                         // Centre Y from bottom
eth_w   = 16.5 + port_clearance;         // Width along Y
eth_h   = 13.5 + port_clearance;         // Height
eth_z   = 6.65;                          // Centre Z above PCB top

// USB 3.0 dual stacked (blue ports)
usb3_cy = 29.0;
usb3_w  = 15.0 + port_clearance;
usb3_h  = 16.0 + port_clearance;
usb3_z  = 8.0;

// USB 2.0 dual stacked (black ports)
usb2_cy = 47.0;
usb2_w  = 15.0 + port_clearance;
usb2_h  = 16.0 + port_clearance;
usb2_z  = 8.0;

// --- LEFT EDGE (X=0 wall) ---

// microSD card slot (on PCB underside)
sd_cy   = 28.0;                          // Centre Y from bottom
sd_w    = 14.0 + port_clearance;         // Width along Y
sd_h    = 3.0  + port_clearance;         // Height
sd_z    = -1.0;                          // Below PCB top (underside)

// PCIe FFC connector (on left edge, small slot)
pcie_cy = 24.5;
pcie_w  = 18.0;
pcie_h  = 3.5;

// --- ON-BOARD COMPONENTS (accessed through lid) ---

// Power button (tactile switch)
pwr_btn_x = 14.0;
pwr_btn_y = 51.5;

// Fan connector (4-pin JST-SH, PWM)
fan_x = 46.5;
fan_y = 47.0;

// GPIO header span
gpio_x_start = 7.1;
gpio_x_end   = 58.1;  // ~51mm span
gpio_y       = 52.5;

// Fan grill centre position (over SoC/heat spreader)
// Computed here at global scope so all modules can reference it
fan_cx = wall_thickness + case_clearance + 43;
fan_cy = wall_thickness + case_clearance + 28;

// ============================================================
// UTILITY MODULES
// ============================================================

// 2D rounded rectangle (centred)
module rrect_2d(l, w, r) {
    r_s = min(r, l/2, w/2);
    offset(r = r_s)
        square([l - 2*r_s, w - 2*r_s], center = true);
}

// 3D rounded box (bottom at z=0)
module rbox(l, w, h, r) {
    linear_extrude(height = h)
        rrect_2d(l, w, r);
}

// Mounting standoff
module standoff(x, y, h, hole_d, post_d) {
    translate([x, y, 0])
        difference() {
            cylinder(h = h, d = post_d);
            translate([0, 0, -0.01])
                cylinder(h = h + 0.02, d = hole_d);
        }
}

// Hex ventilation pattern (centred at origin)
module hex_vent(area_l, area_w, hex_d, web) {
    r = hex_d / 2;
    dx = hex_d + web;
    dy = (hex_d + web) * sin(60);
    cols = floor(area_l / dx);
    rows = floor(area_w / dy);
    
    for (c = [0 : cols - 1])
        for (r_idx = [0 : rows - 1]) {
            x_off = (r_idx % 2 == 0) ? 0 : dx / 2;
            px = -area_l/2 + dx/2 + c * dx + x_off;
            py = -area_w/2 + dy/2 + r_idx * dy;
            
            if (abs(px) < area_l/2 - hex_d/2 && abs(py) < area_w/2 - hex_d/2)
                translate([px, py, 0])
                    cylinder(h = 50, r = r, $fn = 6, center = true);
        }
}

// ============================================================
// PORT CUTOUT HELPERS
// ============================================================

// Cutout through Y=0 wall (bottom edge)
module cut_bottom(cx, w, h, z_center) {
    translate([
        board_x_off + cx - w/2,
        -0.1,
        board_z_pcb_top + z_center - h/2
    ])
        cube([w, wall_thickness + case_clearance + 0.2, h]);
}

// Cutout through X=max wall (right edge)
module cut_right(cy, w, h, z_center) {
    translate([
        ext_length - wall_thickness - 0.1,
        board_y_off + cy - w/2,
        board_z_pcb_top + z_center - h/2
    ])
        cube([wall_thickness + case_clearance + 0.2, w, h]);
}

// Cutout through X=0 wall (left edge)
module cut_left(cy, w, h, z_center) {
    translate([
        -0.1,
        board_y_off + cy - w/2,
        board_z_pcb_top + z_center - h/2
    ])
        cube([wall_thickness + case_clearance + 0.2, w, h]);
}

// ============================================================
// BOTTOM CASE
// ============================================================
module bottom_case() {
    difference() {
        union() {
            // === OUTER SHELL ===
            difference() {
                translate([ext_length/2, ext_width/2, 0])
                    rbox(ext_length, ext_width, ext_height_bottom, corner_radius);
                
                translate([ext_length/2, ext_width/2, floor_thickness])
                    rbox(inner_length, inner_width,
                         ext_height_bottom + 1,
                         max(corner_radius - wall_thickness, 0.5));
            }
            
            // === MOUNTING STANDOFFS ===
            for (pos = mount_positions)
                translate([board_x_off, board_y_off, floor_thickness])
                    standoff(pos[0], pos[1], board_standoff, mount_hole_dia, mount_post_dia);
            
            // === LID ALIGNMENT LIP ===
            lip_r_out = max(corner_radius - wall_thickness, 0.5);
            lip_r_in  = max(lip_r_out - lip_width, 0.5);
            
            translate([ext_length/2, ext_width/2, ext_height_bottom])
                difference() {
                    rbox(inner_length, inner_width, lip_height, lip_r_out);
                    translate([0, 0, -0.01])
                        rbox(inner_length - 2*lip_width, inner_width - 2*lip_width,
                             lip_height + 0.02, lip_r_in);
                }
        }
        
        // === PORT CUTOUTS ===
        
        // Bottom edge
        cut_bottom(usbc_cx,  usbc_w,  usbc_h,  usbc_z);
        cut_bottom(hdmi0_cx, hdmi0_w, hdmi0_h, hdmi0_z);
        cut_bottom(hdmi1_cx, hdmi1_w, hdmi1_h, hdmi1_z);
        
        // Right edge
        cut_right(eth_cy,  eth_w,  eth_h,  eth_z);
        cut_right(usb3_cy, usb3_w, usb3_h, usb3_z);
        cut_right(usb2_cy, usb2_w, usb2_h, usb2_z);
        
        // Left edge — microSD
        cut_left(sd_cy, sd_w, sd_h, sd_z);
        
        // Left edge — PCIe FFC (optional, uncomment if needed)
        // cut_left(pcie_cy, pcie_w, pcie_h, 1.0);
        
        // === BOTTOM VENTILATION ===
        translate([ext_length/2, ext_width/2, 0])
            hex_vent(ext_length - 30, ext_width - 20, 4.5, 1.8);
    }
}

// ============================================================
// LID
// ============================================================
module lid() {
    total_h = lid_thickness + lip_height;
    
    difference() {
        union() {
            // === MAIN LID PLATE ===
            translate([ext_length/2, ext_width/2, 0])
                rbox(ext_length, ext_width, lid_thickness, corner_radius);
            
            // === LID INNER SKIRT ===
            skirt_l = inner_length - 2*snap_tolerance;
            skirt_w = inner_width  - 2*snap_tolerance;
            skirt_r = max(corner_radius - wall_thickness - snap_tolerance, 0.5);
            skirt_r_in = max(skirt_r - lip_width, 0.5);
            
            translate([ext_length/2, ext_width/2, -lip_height])
                difference() {
                    rbox(skirt_l, skirt_w, lip_height + 0.01, skirt_r);
                    translate([0, 0, -0.01])
                        rbox(skirt_l - 2*lip_width, skirt_w - 2*lip_width,
                             lip_height + 0.03, skirt_r_in);
                }
            
            // === SNAP-FIT BUMPS ===
            bump_h   = 0.5;
            bump_len = 10.0;
            
            // Front & back
            for (y_pos = [wall_thickness + snap_tolerance + 0.1,
                          ext_width - wall_thickness - snap_tolerance - bump_h - 0.1])
                translate([ext_length/2 - bump_len/2, y_pos, -lip_height + lip_height*0.3])
                    cube([bump_len, bump_h, lip_height*0.4]);
            // Left & right
            for (x_pos = [wall_thickness + snap_tolerance + 0.1,
                          ext_length - wall_thickness - snap_tolerance - bump_h - 0.1])
                translate([x_pos, ext_width/2 - bump_len/2, -lip_height + lip_height*0.3])
                    cube([bump_h, bump_len, lip_height*0.4]);
        }
        
        // === FAN OPENING (30mm fan, 26mm intake hole) ===
        translate([fan_cx, fan_cy, -lip_height - 0.1])
            cylinder(h = total_h + 0.2, d = 26);
        
        // === FAN MOUNTING HOLES (M3, 24mm bolt pattern for 30mm fan) ===
        for (dx = [-1, 1])
            for (dy = [-1, 1])
                translate([fan_cx + dx*12, fan_cy + dy*12, -lip_height - 0.1])
                    cylinder(h = total_h + 0.2, d = 3.2);
        
        // === TOP VENTILATION (hex grid, avoiding fan area) ===
        // Vent area on the side of the SoC opposite the fan
        translate([ext_length/2 + 15, ext_width/2, lid_thickness/2])
            hex_vent(25, 30, 5.0, 1.5);
        translate([ext_length/2 - 20, ext_width/2, lid_thickness/2])
            hex_vent(20, 25, 5.0, 1.5);
        
        // === POWER BUTTON ACCESS ===
        translate([board_x_off + pwr_btn_x, board_y_off + pwr_btn_y, -lip_height - 0.1])
            cylinder(h = total_h + 0.2, d = 4.0);
        
        // === STATUS LED LIGHT PIPES ===
        // Power LED (red) & Activity LED (green) - near the Ethernet port
        translate([board_x_off + 81.0, board_y_off + 3.5, -lip_height - 0.1])
            cylinder(h = total_h + 0.2, d = 2.0);
        translate([board_x_off + 81.0, board_y_off + 7.0, -lip_height - 0.1])
            cylinder(h = total_h + 0.2, d = 2.0);
        
        // === EMBOSSED TEXT ===
        translate([ext_length - 18, 8, lid_thickness - 0.4])
            linear_extrude(height = 0.5)
                text("RPi 5", size = 4.5, font = "Liberation Sans:style=Bold",
                     halign = "center", valign = "center");
    }
    
    // === FAN GRILL (structural spokes across opening) ===
    intersection() {
        translate([ext_length/2, ext_width/2, 0])
            rbox(ext_length, ext_width, lid_thickness, corner_radius);
        
        union() {
            // Radial spokes
            spoke_n = 6;
            for (a = [0 : 360/spoke_n : 359])
                translate([fan_cx, fan_cy, 0])
                    rotate([0, 0, a])
                        translate([-0.6, -13, 0])
                            cube([1.2, 26, lid_thickness]);
            
            // Support ring
            translate([fan_cx, fan_cy, 0])
                difference() {
                    cylinder(h = lid_thickness, d = 18);
                    translate([0, 0, -0.01])
                        cylinder(h = lid_thickness + 0.02, d = 16);
                }
        }
    }
}

// ============================================================
// GPIO ACCESS LID (alternate version with GPIO slot)
// ============================================================
module lid_gpio() {
    difference() {
        lid();
        
        // GPIO header slot through lid
        translate([
            board_x_off + gpio_x_start - 1,
            board_y_off + gpio_y - 3.5,
            -lip_height - 0.1
        ])
            cube([gpio_x_end - gpio_x_start + 2, 7,
                  lid_thickness + lip_height + 0.2]);
    }
}

// ============================================================
// DISPLAY OPTIONS
// ============================================================

/* [Display Options] */
show_bottom    = true;     // Render bottom case
show_lid       = true;     // Render lid
gpio_lid       = false;    // Use GPIO-access lid variant
assembled      = false;    // true = stacked view, false = print layout
explode        = 10;       // Explode distance for assembled view

module chosen_lid() {
    if (gpio_lid) lid_gpio();
    else lid();
}

if (assembled) {
    if (show_bottom)
        color("SlateGray", 0.9) bottom_case();
    if (show_lid)
        color("DimGray", 0.9)
            translate([0, 0, ext_height_bottom + lip_height + explode])
                chosen_lid();
} else {
    // Print layout — side by side, lid flipped
    if (show_bottom)
        color("SlateGray", 0.9)
            bottom_case();
    if (show_lid)
        color("DimGray", 0.9)
            translate([ext_length + 10, 0, lid_thickness])
                rotate([180, 0, 0])
                    chosen_lid();
}

// ============================================================
// PRINTING & ASSEMBLY GUIDE
// ============================================================
//
// RECOMMENDED PRINT SETTINGS:
//   Layer height:      0.2 mm (0.16 mm for fine detail)
//   Infill:            15-20%
//   Wall count:        3 perimeters
//   Top/bottom layers: 4
//   Supports:          NONE required
//   Material:          PLA, PETG, or ABS
//   Brim:              Optional 3mm brim if using ABS
//
// PRINT ORIENTATION:
//   Bottom case: Upright (opening facing UP)
//   Lid:         Upside-down (flat top on build plate)
//                The print layout already flips the lid
//
// ASSEMBLY:
//   1. Secure Pi 5 with 4× M2.5 × 6mm pan-head screws
//   2. Optional: Mount 30mm×30mm 5V PWM fan on lid
//      using M3 × 12mm screws + nuts
//   3. Snap lid onto bottom case
//   4. Power button accessible through lid hole
//
// CUSTOMIZATION:
//   - snap_tolerance: Increase if lid is too tight
//   - port_clearance: Increase if cables don't fit
//   - gpio_lid = true: Lid with GPIO access slot
//   - assembled = true: Preview assembled case
//   - $fn = 120: Smoother curves for final export
//
// RASPBERRY PI 5 FEATURES:
//   - No 3.5mm audio jack (removed, confirmed by STEP)
//   - On-board power button (accessible through lid)
//   - PCIe FFC connector on left edge
//   - 4-pin PWM fan connector for active cooling
//   - UART debug header near power button
//
// ============================================================
