# CVAT Auto-Annotation Speed Optimization Plan

## Problem
CVAT's auto-annotation processes frames one at a time via HTTP to Nuclio, achieving ~4fps on a T4 GPU when the model itself can do 30+ fps. For a 4,296 frame video, this takes ~18 minutes instead of ~2 minutes.

## Root Cause
The main bottleneck is in `cvat/apps/lambda_manager/views.py` at `_call_detector()` (line 999). For EACH frame sequentially:
1. Fetch frame from disk
2. Base64 encode it
3. Send HTTP POST to Nuclio
4. Wait for response
5. Process result
6. Move to next frame

While the GPU processes one frame, everything else sits idle.

## All Identified Bottlenecks

| # | Bottleneck | File/Line | Impact |
|---|-----------|-----------|--------|
| B1 | Sequential frame-by-frame loop | `views.py:999` `for frame in frame_set` | PRIMARY - each frame waits for previous |
| B2 | Single HTTP request per frame | `gateway.invoke()` one image per request | Network round-trip overhead per frame |
| B3 | Base64 encoding overhead | `_get_image()` line 653 | ~300KB JPEG becomes ~400KB base64, done serially |
| B4 | Frame provider recreated per frame | `_get_image()` line 650 | Loses cache benefits |
| B5 | Nuclio numWorkers=1 for GPU | `function-gpu.yaml` | Can only process one request at a time |
| B6 | New HTTP session per request | `make_requests_session()` | No connection pooling/keep-alive |
| B7 | Nuclio body size limit 32MB | All function yamls | Limits batch size |
| B8 | DB writes every 100 frames | `collector.submit()` line 1024 | Minor bottleneck |

## Solution Layers (Independent, Stackable)

### Layer A: Parallel HTTP Requests (No Nuclio Changes) — ~1 day
Use `ThreadPoolExecutor` in `_call_detector()` to send multiple frames concurrently. While GPU processes frame N, CVAT prepares frames N+1, N+2, N+3.

**Files to change:**
- `cvat/apps/lambda_manager/views.py` — modify `_call_detector()` loop
- `cvat/settings/base.py` — add `MAX_PARALLEL_REQUESTS` setting

**Expected speedup: 3-4x (to ~15 fps)**

### Layer B: Batch Inference Endpoint (Nuclio Changes) — ~2 days
Add batch handler to Nuclio functions that accepts multiple images per request.

**Files to change:**
- `serverless/onnx/WongKinYiu/yolov7/nuclio/main.py` — add batch handler
- `serverless/*/nuclio/function*.yaml` — increase body size limit

**Expected speedup: additional 2x on top of Layer A**

### Layer C: HTTP Session Reuse — ~30 min
Reuse `requests.Session` across invocations within a single auto-annotation job.

**Files to change:**
- `cvat/apps/lambda_manager/views.py` — pass session to `gateway.invoke()`

**Expected speedup: ~1.3x**

### Layer D: Fix Frame Provider Cache — ~30 min
Pass a shared `TaskFrameProvider` instance instead of recreating per frame.

**Files to change:**
- `cvat/apps/lambda_manager/views.py` — modify `_get_image()` to accept reusable provider

**Expected speedup: ~1.2x**

## Combined Expected Results

| Configuration | FPS | Time for 4,296 frames |
|--------------|-----|----------------------|
| Current | ~4 | ~18 min |
| Layer A alone | ~12-15 | ~5-6 min |
| Layers A+C+D | ~15-20 | ~3.5-5 min |
| All layers | ~25-30 | ~2.5-3 min |

## Safety
- Interactive annotation (SAM clicks) uses a completely different code path (`FunctionViewSet.call()`) and is NOT affected
- Batch processing only modifies `_call_detector()` which runs in the RQ worker
- Nuclio batch handler maintains backward compatibility (checks for `"images"` key)

## Implementation Order
1. Layer D (frame provider cache) — simplest fix
2. Layer C (session reuse) — simple fix
3. Layer A (parallel requests) — biggest impact
4. Layer B (batch Nuclio endpoint) — optional, biggest engineering effort

## Key Files
- `cvat/apps/lambda_manager/views.py` — main changes (the bottleneck loop, gateway, image fetching)
- `cvat/settings/base.py` — configuration
- `cvat/apps/engine/frame_provider.py` — TaskFrameProvider reuse
- `cvat/utils/http.py` — session management
- `serverless/onnx/WongKinYiu/yolov7/nuclio/main.py` — batch endpoint (Layer B only)
