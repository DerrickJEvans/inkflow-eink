# cache_manager.py - Local disk slide caching utilities for Python Client
import os
import json

def get_cache_dir():
    """Resolves and creates the local cache folder"""
    cache_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cache')
    os.makedirs(cache_dir, exist_ok=True)
    return cache_dir

def read_cache_manifest():
    """Reads and parses the carousel slide cache manifest JSON file"""
    cache_dir = get_cache_dir()
    manifest_path = os.path.join(cache_dir, 'cache_manifest.json')
    if os.path.exists(manifest_path):
        try:
            with open(manifest_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"[Cache Warning] Failed to parse cache manifest: {e}")
    return {}

def write_cache_manifest(manifest):
    """Saves the carousel slide cache manifest JSON file"""
    cache_dir = get_cache_dir()
    manifest_path = os.path.join(cache_dir, 'cache_manifest.json')
    try:
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2)
    except Exception as e:
        print(f"[Cache Error] Failed to write cache manifest: {e}")

def get_cached_slide(index):
    """Retrieves cached 1-bit raw bytes for a given slide index"""
    cache_dir = get_cache_dir()
    slide_path = os.path.join(cache_dir, f"slide_{index}.raw")
    if os.path.exists(slide_path):
        try:
            with open(slide_path, 'rb') as f:
                return f.read()
        except Exception as e:
            print(f"[Cache Error] Failed to read cached slide {index}: {e}")
    return None

def save_cached_slide(index, raw_bytes):
    """Saves raw E-Paper frame bytes to local slide cache"""
    cache_dir = get_cache_dir()
    slide_path = os.path.join(cache_dir, f"slide_{index}.raw")
    try:
        with open(slide_path, 'wb') as f:
            f.write(raw_bytes)
    except Exception as e:
        print(f"[Cache Error] Failed to write cached slide {index}: {e}")

def clear_cache_slides():
    """Purges all local raw slide files from the cache directory"""
    cache_dir = get_cache_dir()
    for filename in os.listdir(cache_dir):
        if filename.startswith("slide_") and filename.endswith(".raw"):
            try:
                os.remove(os.path.join(cache_dir, filename))
            except Exception:
                pass
