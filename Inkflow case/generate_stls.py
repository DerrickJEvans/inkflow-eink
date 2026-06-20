import subprocess
import os
import sys

# Paths
openscad_path = r"C:\Program Files\OpenSCAD\openscad.exe"
scad_file = "braun_appliance.scad"
bezel_stl = "braun_front_bezel.stl"
case_stl = "braun_back_case.stl"

if not os.path.exists(openscad_path):
    print(f"Error: OpenSCAD not found at {openscad_path}")
    sys.exit(1)

if not os.path.exists(scad_file):
    print(f"Error: OpenSCAD file not found at {scad_file}")
    sys.exit(1)

def run_openscad(part_name, output_file):
    print(f"Compiling and exporting '{part_name}' to {output_file}...")
    cmd = [
        openscad_path,
        "-o", output_file,
        "-D", f'part="{part_name}"',
        scad_file
    ]
    try:
        result = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        print(f"Successfully generated {output_file}")
        if result.stderr:
            print("OpenSCAD Output:")
            print(result.stderr)
    except subprocess.CalledProcessError as e:
        print(f"Failed to generate {output_file}!")
        print("Error details:")
        print(e.stderr)
        sys.exit(1)

# Generate bezel
run_openscad("bezel", bezel_stl)

# Generate case
run_openscad("case", case_stl)

print("\n--- All STL files generated successfully! ---")
for f in [bezel_stl, case_stl]:
    size_kb = os.path.getsize(f) / 1024
    print(f"- {f}: {size_kb:.2f} KB")
