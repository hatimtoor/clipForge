import json
from pathlib import Path

CHANNELS_FILE = Path(__file__).parent.parent / "channels.json"

def load_channels() -> dict:
    if CHANNELS_FILE.exists():
        try:
            return json.loads(CHANNELS_FILE.read_text())
        except:
            return {}
    return {}

def save_channels(channels: dict):
    CHANNELS_FILE.write_text(json.dumps(channels, indent=2))
