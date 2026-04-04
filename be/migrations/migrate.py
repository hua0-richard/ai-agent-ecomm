"""
Run table migrations. Creates all tables if they don't exist.

Usage:
    python -m migrations.migrate
"""

import os
import sys

# Add parent dir so we can import db module
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.vectors import init_tables

if __name__ == "__main__":
    init_tables()
    print("Migration complete.")
