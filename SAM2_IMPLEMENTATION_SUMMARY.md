# SAM2 Implementation Summary — What We Tried & What Worked

## The Goal
One-click segmentation that tracks across video frames. User clicks on a person, SAM2 segments them and propagates the mask across the entire video.

---

## What DIDN'T Work

### Attempt 1: SAM2 as a Nuclio Tracker
**What we tried:** Created a Nuclio serverless function registered as a `tracker` type. When the user draws a box and hits "track," Nuclio would run SAM2 frame by frame.

**Why it failed:**
- CVAT's tracker protocol sends state back and forth over HTTP between every frame
- SAM2's internal state is hundreds of MB of GPU tensors
- Serializing these tensors to JSON (base64 encoding) created payloads that exceeded the 32MB body size limit
- Even after increasing the limit to 64MB, the serialization/deserialization was fragile and slow
- The BFloat16 tensor format caused numpy serialization errors
- Fundamental architecture mismatch: Nuclio trackers were designed for lightweight state (position vectors), not multi-hundred-MB GPU tensor state

**Files created (still on VM but not the solution):**
- `serverless/pytorch/facebookresearch/sam2/nuclio/main.py` — tracker handler
- `serverless/pytorch/facebookresearch/sam2/nuclio/function-gpu.yaml` — tracker config

### Attempt 2: Frontend "Segment & Track" Toggle
**What we tried:** Modified CVAT's frontend to add a "Segment & track across frames" toggle in the Interactors panel. When enabled, after SAM2 segments an object, it would automatically create a Track and call the SAM2 Nuclio tracker to propagate.

**Why it partially failed:**
- The toggle and UI changes work (they're deployed on the GCP VM)
- Creating the initial mask works
- But the propagation fails because it relies on the Nuclio tracker (Attempt 1) which has the state serialization problem
- Also hit issues: CVAT doesn't support mask-type tracks (only polygon/rectangle), so had to convert masks to polygons
- The `supported_shape_types` annotation format was wrong initially (used `spec` field instead of `supported_shape_types` annotation)

**Files modified:**
- `cvat-ui/src/components/annotation-page/standard-workspace/controls-side-bar/tools-control.tsx` — added segmentAndTrack state, toggle UI, propagateTrackedShape method, relaxed rectangle-only filter

### Attempt 3: CVAT's Official Agent System
**What we tried:** CVAT has an official "agents" system in `ai-models/agents_deployment/sam2/` that runs SAM2 as a long-running process that polls CVAT for work.

**Why it didn't work for us:**
- The agent system requires `POST /api/functions` endpoint to register itself
- This endpoint exists on CVAT's `develop` branch but NOT in v2.60.0 (which we're running)
- The `FunctionViewSet` in v2.60.0 only has `list`, `retrieve`, and `call` — no `create` or `destroy`
- Would need to upgrade CVAT to develop branch, which had a migration bug when we tried it

### Attempt 4: CLI auto-annotate
**What we tried:** `cvat-cli auto-annotate` with the SAM2 tracker function file.

**Why it failed:**
- The CLI's auto-annotate command doesn't support video tasks
- Error: "Preloading media data is only supported for tasks with image chunks; current chunk type is 'video'"

---

## What WORKED

### Attempt 5: Custom Python Script Using CVAT API + SAM2 Directly
**The approach:** A Python script running on the GPU VM that:
1. Reads the initial mask annotation from CVAT via REST API
2. Downloads video frames one at a time from CVAT API
3. Runs SAM2 video predictor with state kept entirely in GPU memory (never serialized)
4. Converts output masks to polygons
5. Uploads polygon annotations back to CVAT via REST API

**Why it works:**
- SAM2's state NEVER leaves the process — no serialization, no HTTP body limits
- Uses the standard CVAT REST API (no special endpoints needed)
- Works with v2.60.0 (no upgrade needed)
- Runs on GPU for fast inference

**Results:** Successfully tracked a person across 30 frames in about 30 seconds. Generated 30 polygon annotations visible in CVAT UI.

**Script location:** `/tmp/sam2_track.py` on the GCP VM (35.194.18.191)

**How to run:**
```bash
# SSH into the VM
gcloud compute ssh cvat-gpu --zone=us-central1-a

# Run the script
PATH="$HOME/.local/bin:$PATH" python3 /tmp/sam2_track.py
```

**Current hardcoded values in the script:**
- `CVAT_URL = "http://35.194.18.191:8080"`
- `AUTH = ("admin", "shofo2024")`
- `TASK_ID = 2`
- `NUM_FRAMES = 30`

**Dependencies installed on the VM:**
- cvat-cli, cvat-sdk
- torch, torchvision
- sam2 (from github.com/facebookresearch/sam2)
- opencv-python-headless, huggingface_hub

---

## What Also Works (Separate from Tracking)

### SAM2 Interactor (Single-Frame Segmentation)
One-click segmentation on a single frame works perfectly via Nuclio:
- Deployed as `pth-facebookresearch-sam2-interactor`
- User clicks on object → gets precise mask
- Returns CVAT-compatible RLE mask format
- Files: `serverless/pytorch/facebookresearch/sam2/nuclio-interactor/main.py` and `function-gpu.yaml`

### YOLO Auto-Detection
Auto-detects all people across all frames:
- Deployed as `onnx-wongkinyiu-yolov7` with GPU
- Runs at ~4fps through Nuclio (optimization plan exists to reach ~25fps)

---

## Architecture for Production

```
User clicks on person in CVAT UI
  → SAM2 Interactor (Nuclio) segments on one frame instantly
  → User clicks "Track All" button (we build this)
  → CVAT backend triggers the Python tracking script on GPU server
  → Script downloads frames, runs SAM2 tracking in GPU memory
  → Script uploads polygon annotations back to CVAT
  → User sees tracked segmentation across all frames
```

---

## Key Lessons

1. **Don't try to serialize GPU model state over HTTP** — it's too large and fragile
2. **Nuclio is great for stateless inference** (SAM interactor, YOLO detector) but bad for stateful tracking
3. **CVAT's agent system solves this correctly** but requires a newer CVAT version
4. **The custom script approach is the right architecture** — keep model state in GPU memory, use CVAT API for I/O only
5. **Port mismatch after VM restart** is a recurring issue — Nuclio registers ports that change when containers restart. Need to pin ports or redeploy after restart.

---

## Next Steps

1. Clean up the tracking script → make it a proper CLI tool with arguments
2. Add a "Track" button in CVAT UI that triggers the script via a backend endpoint
3. Consider upgrading CVAT to develop branch to get official agent support
4. Optimize: batch frame downloads, run on longer videos, track multiple objects
