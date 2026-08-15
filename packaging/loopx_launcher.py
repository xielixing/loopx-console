"""Standalone entry point used by PyInstaller to ship the loopx CLI.

Build (from a checkout with loopx installed):

    pyinstaller --onefile --name loopx --collect-all loopx packaging/loopx_launcher.py

The produced executable is experimental: loopx resolves data files and paths
relative to its package, so validate `loopx.exe quota status` on a clean
machine before relying on it as a distribution asset.
"""

import sys

from loopx.entrypoint import main

if __name__ == "__main__":
    sys.exit(main())
