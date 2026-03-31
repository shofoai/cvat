# SAM2 Video Tracking — Revised Plan

## What Failed and Why

The Nuclio tracker approach failed because:
1. **State serialization problem** — SAM2 maintains internal GPU tensors (~100MB+) as tracking state. The Nuclio tracker protocol requires serializing this state to JSON, sending it over HTTP to the CVAT backend, which signs it, sends it to the frontend, then back to the backend, then back to Nuclio on the next frame. This creates massive payloads that exceed body size limits.
2. **Fundamental mismatch** — Nuclio trackers (like TransT) were designed for lightweight state (a few position vectors). SAM2's state is hundreds of megabytes of GPU tensors. The architecture doesn't fit.

## What CVAT's Team Actually Built

CVAT has an **"agents" system** — a completely different approach from Nuclio. Found in `ai-models/agents_deployment/sam2/`:

### How Agents Work (End-to-End Flow)

1. **Registration**: A CLI command (`cvat-cli function create-native`) registers a "native function" in CVAT's database. This creates an entry in `/api/functions` that says "SAM2 tracker exists and supports masks/polygons."

2. **Agent Process**: A long-running process (`cvat-cli function run-agent`) polls the CVAT API for work. When a user requests tracking, CVAT queues the request, and the agent picks it up.

3. **Processing**: The agent:
   - Downloads the frames from CVAT
   - Loads SAM2 into GPU memory (kept warm between requests)
   - Runs tracking with state **kept in local memory** (no serialization!)
   - Uploads the results back to CVAT via the API

4. **Key insight**: SAM2's state NEVER leaves the agent process. No serialization over HTTP. The agent talks to CVAT to get frames and upload annotations, but the model state stays in GPU memory.

### Architecture Diagram
```
User clicks "Track" in CVAT UI
  → CVAT backend queues a tracking request
  → SAM2 Agent (separate process with GPU) polls for requests
  → Agent downloads frames from CVAT API
  → Agent runs SAM2 tracking (state in GPU memory)
  → Agent uploads annotations back to CVAT API
  → User sees tracked masks in UI
```

## The Plan

### Step 1: Build and Deploy the SAM2 Agent Container

**What to do:**
- Build the Docker image from `ai-models/agents_deployment/sam2/Dockerfile`
- Configure `.env` with our CVAT URL and access token
- Run `docker-compose up` to start the registration + agent

**Assumptions to test:**
- [ ] A1: The agent Docker image builds successfully with GPU support
- [ ] A2: The agent can connect to our CVAT instance via the API
- [ ] A3: The `cvat-cli function create-native` command creates a function entry visible in CVAT's UI
- [ ] A4: The function appears in the Models page and/or Trackers tab

### Step 2: Test Agent-Based Tracking

**What to do:**
- Create a task with a video
- Draw a mask/polygon on frame 1
- Use the tracker (now powered by the agent, not Nuclio)
- Verify the mask propagates across frames

**Assumptions to test:**
- [ ] A5: When user clicks "Track" with the SAM2 function, CVAT creates a tracking request
- [ ] A6: The agent picks up the request and processes it
- [ ] A7: The agent successfully downloads frames from CVAT
- [ ] A8: SAM2 tracking produces correct masks
- [ ] A9: The agent successfully uploads tracked annotations back to CVAT
- [ ] A10: The user sees the tracked masks in the UI

### Step 3: Integrate with Our SAM2 Interactor

**What to do:**
- User uses SAM2 Segment (our interactor) to create initial mask
- The "Segment & track" toggle creates a Track from the mask
- The agent-based SAM2 tracker propagates it

**Assumptions to test:**
- [ ] A11: The agent-based tracker accepts polygon/mask shapes from our interactor
- [ ] A12: The frontend's "Segment & track" flow works with agent-based tracking
- [ ] A13: The combined workflow (interactor → agent tracker) produces correct results

## What We Keep vs. What We Change

### Keep (already working):
- SAM2 Interactor Nuclio function (one-click segmentation) ✓
- YOLO Nuclio function (auto-detection) ✓
- Frontend "Segment & track" toggle ✓
- Frontend polygon/mask track support ✓

### Replace:
- SAM2 Nuclio tracker → SAM2 Agent tracker

### Key Difference from Before:
The agent approach means tracking isn't instant in the UI — the user clicks "track," and there's a delay while the agent processes. But it WORKS because state stays in memory. This is the same UX as "Automatic annotation" with YOLO — you wait, then results appear.

## Implementation Steps

```
1. Generate CVAT API access token (admin account)
2. Build SAM2 agent Docker image with GPU support
3. Set environment variables (CVAT_BASE_URL, CVAT_ACCESS_TOKEN, USE_CUDA=true)
4. Run registration container (creates function in CVAT)
5. Run agent container (starts polling for work)
6. Test: create task, draw mask, track with SAM2
7. If working: integrate with our interactor + toggle
```

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Agent API might need features not in v2.60.0 | Medium | High | Check if `function create-native` exists in v2.60.0 CLI |
| GPU memory: SAM2 + YOLO + SAM1 may not fit on T4 (15GB) | Medium | Medium | Use SAM2 tiny model, stop unused models |
| Agent polling delay feels slow to users | Low | Low | Acceptable for video tracking |
| Docker build fails | Low | Low | Dependencies are well-defined |

## Critical Finding: Version Requirement

**CONFIRMED: v2.60.0 does NOT have native function support.** The `develop` branch has `create` and `destroy` methods on FunctionViewSet, but v2.60.0 does not. The agents system requires the develop branch (or a future release).

### Options:

**Option A: Upgrade CVAT to develop branch**
- Pro: Gets us the official agent system, tested by CVAT's team
- Con: The develop branch had a migration bug when we tried it before (the profile issue). May have other instabilities.
- Risk: Medium — develop branch may have other breaking changes

**Option B: Backport the native function endpoints to v2.60.0**
- Pro: Keep our stable v2.60.0 base
- Con: Need to cherry-pick and adapt code from develop
- Risk: Medium — may miss dependencies

**Option C: Skip the agent system, use the SDK directly as a batch script**
- Pro: No CVAT changes needed. Run `cvat-cli auto-annotate` with SAM2 tracker function file
- Con: Not integrated into the UI — it's a CLI workflow, not click-and-track
- Risk: Low — uses stable, documented APIs
- This is essentially Phase 1C (batch pipeline) which we planned anyway

### Recommended Path:

**Start with Option C** — it works today with no code changes:
```bash
cvat-cli --server-host http://<IP>:8080 auto-annotate \
  --function-file ai-models/tracker/sam2/func.py \
  -p model_id=str:facebook/sam2.1-hiera-tiny \
  -p device=str:cuda \
  <task_id>
```

This runs SAM2 tracking on all existing annotations in a task. SAM2 keeps state in memory (no serialization). Results upload back to CVAT.

Then **plan Option A (upgrade to develop)** as a separate step to get the full agent-based UI integration.

## Updated Implementation Steps

### Immediate (works now):
1. Install cvat-cli + cvat-sdk on the GCP VM
2. Create a task, add initial annotation (SAM2 interactor mask on frame 1)
3. Run `cvat-cli auto-annotate` with SAM2 tracker to propagate
4. Verify results in CVAT UI

### Next (requires CVAT upgrade):
5. Upgrade CVAT from v2.60.0 to develop (fix migration bug first)
6. Deploy SAM2 agent via docker-compose
7. Test agent-based tracking from the UI
