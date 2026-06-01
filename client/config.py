# config.py - Configuration settings loader for the Python E-Ink Client
import os

# Resolve the absolute path of the local .env file in the client directory
current_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(current_dir, '.env')

# Manually parse the .env file if it exists to avoid external pip dependencies
if os.path.exists(env_path):
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            # Ignore empty lines and comments
            if not line or line.startswith('#'):
                continue
            # Parse KEY=VALUE
            if '=' in line:
                key, val = line.split('=', 1)
                key = key.strip()
                val = val.strip()
                # Strip wrapping quotes if present
                if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                    val = val[1:-1]
                # Write to os.environ if not already set (allowing standard shell env overrides)
                if key not in os.environ:
                    os.environ[key] = val

# Helper function to parse booleans safely
def parse_bool(val):
    if not val:
        return False
    return val.lower() in ('true', '1', 'yes', 'on')

# Helper function to parse integers safely
def parse_int(val):
    try:
        return int(val) if val else None
    except ValueError:
        return None

# ==============================================================================
#                               CONFIG VARIABLES
# ==============================================================================

# 1. Server Settings
SERVER_IP = os.environ.get('TRMNL_SERVER_IP', '192.168.1.100')
SERVER_PORT = os.environ.get('TRMNL_SERVER_PORT', '5000')

# 2. Device Settings
DEVICE_NAME = os.environ.get('TRMNL_DEVICE_NAME', 'Living Room Pi')
DEVICE_ID = os.environ.get('TRMNL_DEVICE_ID', 'dynamic_mac')

# 3. Screen & Driver Selection
SCREEN_TYPE = os.environ.get('TRMNL_SCREEN_TYPE', '4in26')
DISPLAY_TYPE = os.environ.get('TRMNL_DISPLAY_TYPE', 'waveshare')

# 4. Color Contrast & Sleep Settings
INVERT_COLORS = parse_bool(os.environ.get('TRMNL_INVERT_COLORS', 'false'))
DEFAULT_POLL_INTERVAL = parse_int(os.environ.get('TRMNL_DEFAULT_POLL_INTERVAL', '1800')) or 1800

# 5. Manual Hardware Resolution Overrides
WIDTH = parse_int(os.environ.get('TRMNL_WIDTH', ''))
HEIGHT = parse_int(os.environ.get('TRMNL_HEIGHT', ''))
WAVESHARE_MODEL = os.environ.get('TRMNL_WAVESHARE_MODEL', '') or None
