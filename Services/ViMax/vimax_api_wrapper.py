"""
FastAPI wrapper around ViMax.
This file lives at: services/vimax/api_wrapper.py

Run with:
  uv run uvicorn api_wrapper:app --host 0.0.0.0 --port 8000 --reload
"""

from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Literal
import uuid
import asyncio
import subprocess
import json
import os
import sys
from pathlib import Path

app = FastAPI(title="ViMax Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory job store (use Redis in production)
jobs: dict = {}

# ── Request/Response Models ───────────────────────────────────────────────────

class Idea2VideoRequest(BaseModel):
    content: str           # the idea/concept
    style: str = "Realistic"
    requirements: str = ""

class Script2VideoRequest(BaseModel):
    content: str           # the full script
    style: str = "Realistic"
    requirements: str = ""

class JobStatusResponse(BaseModel):
    job_id: str
    status: str            # queued | processing | completed | failed
    progress: int = 0
    output_url: Optional[str] = None
    error: Optional[str] = None
    stages: list = []

# ── Background Job Runner ─────────────────────────────────────────────────────

def run_vimax_job(job_id: str, job_type: str, content: str, style: str, requirements: str):
    """Runs ViMax pipeline in a subprocess and tracks status."""
    jobs[job_id]["status"] = "processing"
    jobs[job_id]["progress"] = 10

    try:
        # Determine which script to run
        script = "main_idea2video.py" if job_type == "idea2video" else "main_script2video.py"
        vimax_dir = Path(__file__).parent / "ViMax"

        # Write temp config for this job
        working_dir = vimax_dir / ".working_dir" / job_id
        working_dir.mkdir(parents=True, exist_ok=True)

        # Patch the script to use our content
        # We inject variables via environment
        env = {
            **os.environ,
            "VIMAX_IDEA": content,
            "VIMAX_STYLE": style,
            "VIMAX_REQUIREMENTS": requirements,
            "VIMAX_WORKING_DIR": str(working_dir),
        }

        jobs[job_id]["progress"] = 20
        jobs[job_id]["stages"].append({"stage": "script", "message": "Generating script..."})

        result = subprocess.run(
            ["uv", "run", "python", script],
            cwd=str(vimax_dir),
            capture_output=True,
            text=True,
            timeout=900,  # 15 minute timeout
            env=env,
        )

        if result.returncode != 0:
            raise Exception(f"ViMax failed: {result.stderr[-500:]}")

        jobs[job_id]["progress"] = 90
        jobs[job_id]["stages"].append({"stage": "finalizing", "message": "Finalizing..."})

        # Find output video file
        output_files = list(working_dir.glob("**/*.mp4"))
        if not output_files:
            raise Exception("No output video file found")

        output_path = str(output_files[0])
        jobs[job_id]["status"] = "completed"
        jobs[job_id]["progress"] = 100
        jobs[job_id]["output_url"] = output_path  # backend will upload to S3

    except subprocess.TimeoutExpired:
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = "Generation timed out"
    except Exception as e:
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = str(e)

# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "vimax"}

@app.post("/generate/idea2video")
async def generate_idea2video(req: Idea2VideoRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "progress": 0,
        "output_url": None,
        "error": None,
        "stages": [],
    }

    background_tasks.add_task(
        run_vimax_job, job_id, "idea2video", req.content, req.style, req.requirements
    )

    return {"job_id": job_id, "status": "queued"}

@app.post("/generate/script2video")
async def generate_script2video(req: Script2VideoRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "progress": 0,
        "output_url": None,
        "error": None,
        "stages": [],
    }

    background_tasks.add_task(
        run_vimax_job, job_id, "script2video", req.content, req.style, req.requirements
    )

    return {"job_id": job_id, "status": "queued"}

@app.get("/jobs/{job_id}/status", response_model=JobStatusResponse)
def get_job_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id]
