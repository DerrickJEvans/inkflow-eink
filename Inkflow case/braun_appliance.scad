// ============================================================
// Braun-Style E-Ink Smart Appliance Enclosure (V2 - Elevations Matched)
// Designed by Antigravity for 3D Printing (FDM/SLA)
// Styled in the iconic Dieter Rams Braun design language
// ============================================================
//
// Fits:
//   - 7.5-inch E-Ink Display (Waveshare/TRMNL dimensions)
//   - Raspberry Pi 4 or 5
//   - MPR121 Capacitive Touch Sensor (for flush touch buttons)
//
// Updates in V2 (Matched to Orthographic Elevations):
//   - Changed to 5 front touch buttons (iconic Braun clock/calendar control)
//   - Centered pill-shaped USB-C power port on the back cover
//   - Added 4mm recessed base/foot at the bottom of the device
//   - Shifted Raspberry Pi internally to align its USB-C port with case center
// ============================================================

/* [Rendering Quality] */
$fn = 120;

/* [Global Dimensions] */
case_w = 190.0;          // Total width of the face
case_h = 150.0;          // Total height of the face
wall_thick = 2.5;        // Outer wall thickness
corner_r = 4.0;          // External corner rounding radius

/* [Wedge Angle / Depth] */
depth_top = 15.0;        // Enclosure depth at the top
depth_bottom = 55.0;     // Enclosure depth at the bottom
// Wedge slope angle: theta = atan((depth_bottom - depth_top) / case_h) ≈ 14.9 degrees

/* [7.5" E-Ink Screen cutout] */
// Screen active area is ~163.2mm x 97.92mm.
screen_w = 164.0;        // Bezel cutout width
screen_h = 99.0;         // Bezel cutout height
screen_cx = 95.0;        // Centered horizontally (case_w / 2)
screen_cy = 85.5;        // Shifted upwards for top-heavy Braun style

// Screen board mounting hole spacing: 161.2mm x 102.2mm
screen_mount_dx = 161.2;
screen_mount_dy = 102.2;
screen_mount_post_h = 4.0;
screen_mount_post_d = 5.0;
screen_mount_hole_d = 2.2; // Pilot hole for M2.5 screws

/* [Capacitive Touch Buttons - 5 Buttons Matched to Elevations] */
btn_r = 6.0;             // Touch button radius (12mm diameter)
btn_depth = 0.5;         // Bezel front recess depth
btn_y = 18.0;            // Vertical center in bottom section
btn_xs = [40.0, 67.5, 95.0, 122.5, 150.0]; // 5 Buttons symmetrically spaced
btn_pocket_r = 5.0;      // Back pocket radius (10mm diameter)
btn_pocket_h = 1.0;      // Remainder thickness of plastic (touch sensing wall)

/* [MPR121 Breakout Board Standoffs] */
mpr_mount_dx = 20.0;     // Horizontal spacing of mounting holes
mpr_mount_y = 32.0;      // Positioned just above touch buttons, below screen
mpr_mount_h = 3.0;       // Standoff height
mpr_mount_d = 4.5;
mpr_mount_hole_d = 1.8;  // Pilot hole for M2 screws

/* [Raspberry Pi 4/5 Mounting Standoffs] */
// Standard Pi mounting pattern: 58.0mm x 49.0mm
pi_mount_dx = 58.0;
pi_mount_dy = 49.0;
pi_mount_h = 5.0;        // Standoff height from back wall
pi_mount_d = 6.0;        // Outer diameter of standoff
pi_mount_hole_d = 2.2;   // Pilot hole for M2.5 board screws

// Shifting the RPi horizontally so its USB-C port aligns with case center (X=95.0)
// USB-C is 11.2mm from Pi left edge. Pi center is 42.5mm. Offset is -31.3mm.
// Shifted center: 95.0 + 31.3 = 126.3mm.
pi_cx = 126.3;           
pi_cy = 75.0;            // Centered vertically along the slope

/* [Assembly Screws (Case Corners)] */
// Screws to secure back cover to front bezel
case_screw_dx = 180.0;
case_screw_dy = 140.0;
case_screw_post_h = 10.0;
case_screw_post_d = 7.0;
case_screw_hole_d = 2.2;  // Pilot hole in front bezel
case_screw_clear_d = 3.2; // Clearance hole in back case
case_screw_head_d = 6.0;  // Countersink head diameter
case_screw_head_h = 2.5;  // Countersink head depth

// ============================================================
// Helper Modules
// ============================================================

// 2D Rounded rectangle centered at origin
module rounded_rect_2d(w, h, r) {
    x_lim = w/2 - r;
    y_lim = h/2 - r;
    hull() {
        translate([-x_lim, -y_lim]) circle(r = r);
        translate([x_lim, -y_lim]) circle(r = r);
        translate([-x_lim, y_lim]) circle(r = r);
        translate([x_lim, y_lim]) circle(r = r);
    }
}

// 3D Standoff post
module standoff_post(h, outer_d, inner_d) {
    difference() {
        cylinder(h = h, d = outer_d);
        translate([0, 0, -0.1])
            cylinder(h = h + 0.2, d = inner_d);
    }
}

// ============================================================
// Part 1: Front Bezel
// ============================================================
module front_bezel() {
    difference() {
        union() {
            // Main front plate base
            linear_extrude(height = wall_thick) {
                translate([case_w/2, case_h/2])
                    rounded_rect_2d(case_w, case_h, corner_r);
            }
            
            // Outer alignment lip to mate with back case
            difference() {
                translate([case_w/2, case_h/2, wall_thick])
                    linear_extrude(height = 1.5)
                        rounded_rect_2d(case_w - 0.2, case_h - 0.2, corner_r);
                translate([case_w/2, case_h/2, wall_thick - 0.1])
                    linear_extrude(height = 1.7)
                        rounded_rect_2d(case_w - 2.0, case_h - 2.0, max(0.5, corner_r - 1.0));
            }
            
            // Screen board mounting standoffs (on the back side)
            for (dx = [-screen_mount_dx/2, screen_mount_dx/2]) {
                for (dy = [-screen_mount_dy/2, screen_mount_dy/2]) {
                    translate([screen_cx + dx, screen_cy + dy, wall_thick])
                        standoff_post(screen_mount_post_h, screen_mount_post_d, screen_mount_hole_d);
                }
            }
            
            // MPR121 mounting standoffs
            for (dx = [-mpr_mount_dx/2, mpr_mount_dx/2]) {
                translate([screen_cx + dx, mpr_mount_y, wall_thick])
                    standoff_post(mpr_mount_h, mpr_mount_d, mpr_mount_hole_d);
            }
            
            // Corner screw posts (to secure back case)
            for (dx = [-case_screw_dx/2, case_screw_dx/2]) {
                for (dy = [-case_screw_dy/2, case_screw_dy/2]) {
                    translate([case_w/2 + dx, case_h/2 + dy, wall_thick])
                        standoff_post(case_screw_post_h, case_screw_post_d, case_screw_hole_d);
                }
            }
        }
        
        // Screen viewport cutout
        translate([screen_cx - screen_w/2, screen_cy - screen_h/2, -1.0])
            cube([screen_w, screen_h, wall_thick + 2.0]);
        
        // Screen glass recess on the back (keeps display flush with bezel)
        // Glass dimension is ~170.2mm x 111.2mm x 1.25mm
        translate([screen_cx - 171.2/2, screen_cy - 112.2/2, wall_thick - 1.25])
            cube([171.2, 112.2, 2.0]);
            
        // Front aesthetic bevel on screen opening (clean 45-deg bevel)
        translate([0, 0, -0.1])
            difference() {
                translate([screen_cx - screen_w/2 - 1.0, screen_cy - screen_h/2 - 1.0, 0])
                    cube([screen_w + 2.0, screen_h + 2.0, 1.2]);
                translate([screen_cx, screen_cy, -0.2])
                    linear_extrude(height = 1.6, scale = 1.02)
                        square([screen_w, screen_h], center = true);
            }
        
        // Touch buttons: shallow circular recess on front
        for (x = btn_xs) {
            translate([x, btn_y, -0.1])
                cylinder(h = btn_depth + 0.1, r = btn_r);
        }
        
        // Touch buttons: thin-wall pockets on the back
        for (x = btn_xs) {
            // Leave exactly btn_pocket_h (1mm) of plastic for capacitive sensing
            translate([x, btn_y, btn_pocket_h])
                cylinder(h = wall_thick, r = btn_pocket_r);
        }
    }
}

// ============================================================
// Part 2: Wedge Back Case
// ============================================================
module back_case() {
    difference() {
        union() {
            // Main outer wedge shell
            difference() {
                // Outer wedge geometry
                hull() {
                    // Bottom slab
                    translate([case_w/2, corner_r, depth_bottom/2])
                        rotate([0, 90, 0])
                            cylinder(h = case_w - 2*corner_r, r = corner_r, center = true);
                    translate([case_w/2, case_h - corner_r, depth_top/2])
                        rotate([0, 90, 0])
                            cylinder(h = case_w - 2*corner_r, r = corner_r, center = true);
                    
                    // Top front-face envelope corners
                    translate([corner_r, corner_r, depth_bottom - corner_r])
                        sphere(r = corner_r);
                    translate([case_w - corner_r, corner_r, depth_bottom - corner_r])
                        sphere(r = corner_r);
                    translate([corner_r, case_h - corner_r, depth_top - corner_r])
                        sphere(r = corner_r);
                    translate([case_w - corner_r, case_h - corner_r, depth_top - corner_r])
                        sphere(r = corner_r);
                }
                
                // Hollow out the wedge, leaving the front open
                // Wall thickness: 2.0mm
                translate([0, 0, -0.1])
                intersection() {
                    translate([0, 0, 0])
                        cube([case_w, case_h, depth_bottom + 1.0]);
                    
                    // Subtract inner wedge
                    hull() {
                        translate([case_w/2, corner_r + 2.0, (depth_bottom - 2.0)/2])
                            rotate([0, 90, 0])
                                cylinder(h = case_w - 2.0*(corner_r + 2.0), r = max(0.5, corner_r - 2.0), center = true);
                        translate([case_w/2, case_h - corner_r - 2.0, (depth_top - 2.0)/2])
                            rotate([0, 90, 0])
                                cylinder(h = case_w - 2.0*(corner_r + 2.0), r = max(0.5, corner_r - 2.0), center = true);
                        
                        translate([corner_r + 2.0, corner_r + 2.0, depth_bottom - 2.0])
                            sphere(r = max(0.5, corner_r - 2.0));
                        translate([case_w - corner_r - 2.0, corner_r + 2.0, depth_bottom - 2.0])
                            sphere(r = max(0.5, corner_r - 2.0));
                        translate([corner_r + 2.0, case_h - corner_r - 2.0, depth_top - 2.0])
                            sphere(r = max(0.5, corner_r - 2.0));
                        translate([case_w - corner_r - 2.0, case_h - corner_r - 2.0, depth_top - 2.0])
                            sphere(r = max(0.5, corner_r - 2.0));
                    }
                }
                
                // Cut off the front face completely so it mates flat with the bezel
                translate([-10.0, -10.0, depth_bottom - 0.1])
                    cube([case_w + 20.0, case_h + 20.0, 50.0]);
            }
            
            // Recessed base/foot at the bottom wall (Y = 0)
            // Extending Y = -4.0mm to Y = 0.5mm (0.5mm overlap inside the Y = 0 wall) for clean manifold union
            translate([case_w/2, -1.75, depth_bottom/2]) {
                rotate([90, 0, 0]) {
                    linear_extrude(height = 4.5, center = true)
                        rounded_rect_2d(case_w - 20.0, depth_bottom - 10.0, corner_r);
                }
            }
            
            // Standoff posts for Raspberry Pi (on the inner sloping back wall)
            // Penetrates the sloped back wall (starts at 1.0 instead of 2.0) for a clean manifold union
            translate([pi_cx, pi_cy, 0]) {
                rotate([-atan((depth_bottom - depth_top) / case_h), 0, 0]) {
                    for (dx = [-pi_mount_dx/2, pi_mount_dx/2]) {
                        for (dy = [-pi_mount_dy/2, pi_mount_dy/2]) {
                            translate([dx, dy, 1.0]) 
                                cylinder(h = pi_mount_h + 1.0, d = pi_mount_d);
                        }
                    }
                }
            }
        }
        
        // --- ASSEMBLY HOLES IN BACK COVER ---
        for (dx = [-case_screw_dx/2, case_screw_dx/2]) {
            for (dy = [-case_screw_dy/2, case_screw_dy/2]) {
                cx = case_w/2 + dx;
                cy = case_h/2 + dy;
                cz = depth_bottom - (depth_bottom - depth_top) * (cy / case_h);
                
                translate([cx, cy, -1.0])
                    cylinder(h = cz + 2.0, d = case_screw_clear_d);
                translate([cx, cy, -0.1])
                    cylinder(h = case_screw_head_h, d = case_screw_head_d);
            }
        }
        
        // --- DIETER RAMS STYLE VENTILATION SLITS ---
        translate([case_w/2, 110, 0]) {
            rotate([-atan((depth_bottom - depth_top) / case_h), 0, 0]) {
                for (row = [-4 : 4]) {
                    translate([0, row * 5.0, -20.0])
                        cube([130.0, 1.8, 50.0], center = true);
                }
            }
        }
        
        // --- CENTERED PILL-SHAPED USB-C PORT ON BACK COVER (ELEVATION MATCHED) ---
        // Sloped back cover cutout centered horizontally (X=95.0), near bottom of slope (Y=12.0)
        translate([95.0, 12.0, 0]) {
            rotate([-atan((depth_bottom - depth_top) / case_h), 0, 0]) {
                translate([0, 0, -10.0]) {
                    hull() {
                        translate([-4.0, 0, 0]) cylinder(h = 25.0, d = 6.5);
                        translate([4.0, 0, 0]) cylinder(h = 25.0, d = 6.5);
                    }
                }
            }
        }
            
        // Pilot screw holes inside the RPi standoffs
        translate([pi_cx, pi_cy, 0]) {
            rotate([-atan((depth_bottom - depth_top) / case_h), 0, 0]) {
                for (dx = [-pi_mount_dx/2, pi_mount_dx/2]) {
                    for (dy = [-pi_mount_dy/2, pi_mount_dy/2]) {
                        translate([dx, dy, -5.0])
                            cylinder(h = pi_mount_h + 10.0, d = pi_mount_hole_d);
                    }
                }
            }
        }
    }
}

// ============================================================
// Render Selector
// ============================================================

/* [Rendering Selector] */
part = "both"; // [both: Assembled View, bezel: Front Bezel Only, case: Back Case Only]

if (part == "both") {
    // Front Bezel facing forward
    color("LightGray")
        translate([0, 0, depth_bottom])
            front_bezel();
            
    // Back case aligned with Bezel
    color("DimGray")
        back_case();
} else if (part == "bezel") {
    // Rotated flat on build plate for printing
    rotate([0, 0, 0])
        front_bezel();
} else if (part == "case") {
    // Rotated flat front-opening down on build plate for printing
    // This orientation does not require support material!
    translate([0, 0, depth_bottom])
        rotate([180, 0, 0])
            back_case();
}
