# Shofo Labeling Platform — Build Plan

## Overview
Building an Encord-like labeling platform on top of open-source CVAT for Shofo's video annotation business. Self-hosted on GCP with GPU for auto-annotation.

---

## PHASE 1A: CVAT Core Understanding
**Goal:** Learn every built-in feature hands-on so we know what exists vs. what we build.

### Annotation Tools (what labelers use day-to-day)
- [x] Bounding box + tracking/interpolation
- [x] Polygon
- [x] Skeleton (kinematic template)
- [x] Tags (frame-level labels) — works but attributes hidden in sidebar, not prominent enough for labelers
- [ ] Mask/Brush tool (pixel-level painting)
- [ ] Points and polylines
- [x] Attributes (adding metadata to any annotation) — supports text, select, checkbox, number types
- [ ] Keyboard shortcuts (how fast labelers actually work)
- [ ] "Outside" / "occluded" / "keyframe" flags on tracks

### Project & Workflow Management
- [x] Projects > Tasks > Jobs
- [x] Assigning jobs to users — assigned job to papi, tested labeler perspective in incognito window
- [x] Job stages: annotation > validation > acceptance — tested full flow
- [x] Job states: new > in progress > completed > rejected — tested reject and resubmit loop
- [x] Creating multiple user accounts with different roles — admin, labeler1, papi created
- [ ] Organizations (your company as an entity)
- [ ] Annotation guides (instructions you write for labelers)

### Review & Quality
- [x] Review mode — what reviewers see (validation stage, Review workspace)
- [x] Issues — pinning problems to specific frames (tested on frame 55)
- [x] Comments — threaded discussions on issues
- [ ] Quality control with ground truth jobs
- [ ] Quality reports and agreement metrics
- [ ] Consensus (multiple labelers on same data)

### Data In/Out
- [x] Uploading from local files — tested with Shofo YC Launch Video
- [x] Export formats (COCO JSON) — exported and reviewed JSON structure
- [x] What the exported data actually looks like — bbox, track_id, attributes, categories
- [ ] Backup/restore
- [ ] API + SDK (programmatic access for automation)

### Analytics & Monitoring
- [ ] The Analytics page
- [ ] Grafana dashboards (event data)
- [ ] What gets logged in ClickHouse

---

## PHASE 1B: GCP + GPU + Auto-Annotation
**Goal:** Deploy CVAT on GCP with GPU, get SAM2 + YOLO running.

- [x] Set up a GCP VM with T4 GPU (34.10.161.153)
- [x] Deploy CVAT on it (v2.60.0, port 8080)
- [x] Deploy Nuclio serverless platform
- [x] Deploy YOLO v7 with GPU — auto-detection working on all frames
- [x] Deploy SAM (Segment Anything) with GPU — interactive segmentation working
- [x] Deploy TransT tracker with GPU — bounding box tracking
- [ ] Deploy SAM2 for video mask tracking
- [ ] Benchmark speed and accuracy on real Shofo videos

---

## PHASE 1C: Batch Auto-Annotation Pipeline
**Goal:** Automate annotation at scale outside the UI.

- [ ] Build a script that takes videos from Shofo's existing pipeline
- [ ] Run YOLO detection + SAM2 segmentation in batch (outside CVAT)
- [ ] Import pre-annotations into CVAT via the SDK
- [ ] Labelers only review/correct rather than annotate from scratch

---

## PHASE 2A: Custom Annotations — Temporal Descriptions
**Goal:** Build what CVAT doesn't have — text descriptions for frame ranges.

This is the biggest custom build. CVAT has no temporal text annotation system.

- [ ] Data model: frame range + structured text description
- [ ] Backend: new Django models, API endpoints, serializers
- [ ] Frontend: new React UI component in the annotation view
- [ ] Select a frame range (e.g., frames 100-350)
- [ ] Attach text description ("Bryan walks toward camera, gestures with hands")
- [ ] Support structured fields (action, intent, objects involved, etc.)
- [ ] Nested/hierarchical descriptions (scene > action > detail)
- [ ] Export as structured JSON alongside visual annotations

**Hard challenges:** Requires modifying both backend (Django) and frontend (React). Single biggest piece of custom work.

---

## PHASE 2B: Advanced Kinematics
**Goal:** Go beyond basic skeleton tracking.

- [ ] Joint angle calculation
- [ ] Velocity/acceleration of body parts
- [ ] Motion trajectory visualization
- [ ] Integrate pose estimation models (MediaPipe, OpenPose) for auto-skeleton placement

---

## PHASE 3A: Workforce Management
**Goal:** Track labeler time, productivity, and deadlines.

Build on top of CVAT's existing events/analytics (ClickHouse):
- [ ] Time tracking — derive from event data (frame views, annotation actions)
- [ ] Dashboards — annotations per hour, accuracy trends per labeler
- [ ] Deadlines — assign due dates to jobs, show overdue items
- [ ] Billing — hours worked x rate per labeler
- [ ] **Flexible job creation** — CVAT locks regular annotation jobs after task creation (only GT jobs can be added via +). Modify the + button to also allow adding annotation jobs with custom frame ranges, enabling mid-project labeler additions and consensus annotation (multiple labelers on same frames).

---

## PHASE 3B: Quality Control
**Goal:** F1 scoring, ground truth comparison, auto-routing.

Extend CVAT's existing ground truth system:
- [ ] F1 scoring — compare labeler output to gold-standard annotations
- [ ] Per-labeler scoring — track accuracy over time
- [ ] Auto-routing — if labeler F1 drops below threshold, flag for retraining
- [ ] Sampling — randomly sample N% of completed jobs for spot-check review

---

## PHASE 3C: Team Management
**Goal:** Onboarding, permissions, and labeler tiers.

- [ ] Onboarding flow — new labeler gets training tasks with annotation guides
- [ ] Role permissions — labelers see only their jobs, reviewers see completed work, admins see everything
- [ ] Labeler tiers — junior labelers get simple tasks, senior get complex

---

## PHASE 4: Polish, Scale & Client Delivery
**Goal:** Production-ready platform.

- [ ] Client-facing portal for delivering labeled datasets
- [ ] Export in customer-requested formats
- [ ] Usage analytics and reporting
- [ ] Scale testing with real volume

---

## Speed Optimization (Planned)
See OPTIMIZATION_PLAN.md for full details. CVAT's auto-annotation runs at ~4fps due to sequential HTTP requests. Plan to achieve ~25-30fps through parallel requests, session reuse, frame caching, and optional batch endpoints. Estimated ~2 days of work.

---

## Key Decisions Made
- Self-hosted CVAT on Google Cloud (MIT license, no vendor lock-in)
- SAM2 for video segmentation, YOLO for detection (GPU required)
- Batch auto-annotation pipeline + interactive Nuclio models for corrections
- Scale: millions to tens of millions of videos (filtered from 3B video index)
- Building instead of buying: Encord = $30k base + $1,500/seat/month vs ~$5-15k/yr infra

## What CVAT Has vs. What We Build

### CVAT gives us:
- Core annotation tools (boxes, polygons, masks, skeletons, tracking)
- AI-assisted labeling (SAM2, YOLO via Nuclio)
- Task/job management and assignment
- Basic quality control and review workflows
- Multi-format export (COCO, YOLO, VOC, etc.)
- API and SDK for automation
- Cloud storage integration (S3, Azure, GCS)
- Organization/team structure

### We build:
- Temporal text descriptions / planning annotations
- Advanced kinematic labeling
- Workforce management (time tracking, dashboards, deadlines)
- Enhanced quality control (F1 scoring, per-labeler metrics, auto-routing)
- Team onboarding and tiered permissions
- Client delivery portal
