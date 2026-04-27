import json
from pathlib import Path

JOBS_FILE = Path(__file__).parent.parent / "jobs.json"

def load_jobs() -> dict:
    if JOBS_FILE.exists():
        try:
            return json.loads(JOBS_FILE.read_text())
        except:
            return {}
    return {}

def save_jobs(jobs: dict):
    JOBS_FILE.write_text(json.dumps(jobs, indent=2))
