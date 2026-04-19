# Shofo Labeling Platform — Build Plan

## Overview
Building an Encord-like labeling platform on top of open-source CVAT for Shofo's video annotation business. Self-hosted on GCP with GPU for auto-annotation.

---

## Current State (2026-04-19)

**Deployed:** CPU-only dev VM `cvat` in `shofo-main` project at `34.45.70.26:8080`. Branch `shofo/main`. Original GPU VM (`34.10.161.153`) disappeared; cofounder will redo GPU + SAM2 work from scratch.

**Shipped this session:**
- **Temporal descriptions (Phase 2A)** — end-to-end: Django model + migration, API + OPA policy, cvat-core methods, sidebar tab with add/edit/delete/preview playback
- **Shofo Full Export** — new `Shofo Full` exporter producing a single JSON with labels, annotations (shapes + tracks + tags), temporal descriptions with timestamps, and video metadata. Internal metadata (create dates, job_id) stripped; only customer-relevant fields remain.
- **Sidebar reorder** — Descriptions tab moved before Issues
- **Quality Control dashboard (Phase 3B, initial slice)** — replaced the open-source paywall stub on the Overview tab with a real dashboard (mean quality / GT conflicts / issues hero cards, GT job summary, per-job table with quality badges, expandable conflicts with click-to-jump-to-exact-shape). Added a Generate/Regenerate report button since open-source UI never exposed one.

**Cofounder handoff (next):** redo SAM2 video segmentation (current polygon-with-interpolation approach produces polygons, not masks — wash), reprovision GPU VM, own the labeling pipeline.

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
- [x] Quality control with ground truth jobs — tested creating GT job, acceptance/completed flow
- [x] Quality reports and agreement metrics — accuracy, precision, recall, conflict breakdown by type (extra/missing/mismatch/low-overlap). Self-hosted UI built from scratch (open-source stubs the overview behind a paywall).
- [ ] Consensus (multiple labelers on same data)

### Data In/Out
- [x] Uploading from local files — tested with Shofo YC Launch Video
- [x] Export formats (COCO JSON) — exported and reviewed JSON structure
- [x] What the exported data actually looks like — bbox, track_id, attributes, categories
- [x] Shofo Full Export — custom format combining annotations + temporal descriptions + timestamps in one JSON (see `cvat/apps/dataset_manager/formats/shofo.py`)
- [ ] Backup/restore
- [ ] API + SDK (programmatic access for automation)

### Analytics & Monitoring
- [ ] The Analytics page
- [ ] Grafana dashboards (event data)
- [ ] What gets logged in ClickHouse

---

## PHASE 1B: GCP + GPU + Auto-Annotation
**Goal:** Deploy CVAT on GCP with GPU, get SAM2 + YOLO running.

> **Status:** Original GPU VM (34.10.161.153) disappeared. Current dev VM (`cvat` in shofo-main, 34.45.70.26) is CPU-only. Cofounder owns redoing this phase from scratch, including SAM2.

- [~] Provision a GCP VM with T4 GPU — cofounder to redo
- [x] Deploy CVAT (v2.60.0, port 8080) — working on CPU VM; apply same steps on new GPU VM
- [~] Deploy Nuclio serverless platform — cofounder to redo
- [~] Deploy YOLO v7 with GPU — cofounder to redo
- [~] Deploy SAM (Segment Anything) with GPU — cofounder to redo
- [~] Deploy TransT tracker with GPU — cofounder to redo
- [ ] Deploy SAM2 for video mask tracking — previous attempt produced polygons-with-interpolation, not real masks. Start from scratch targeting actual per-frame masks.
- [ ] Benchmark speed and accuracy on real Shofo videos

---

## PHASE 1C: Batch Auto-Annotation Pipeline
**Goal:** Automate annotation at scale outside the UI.

- [ ] Build a script that takes videos from Shofo's existing pipeline
- [ ] Run YOLO detection + SAM2 segmentation in batch (outside CVAT)
- [ ] Import pre-annotations into CVAT via the SDK
- [ ] Labelers only review/correct rather than annotate from scratch

---

## PHASE 2A: Custom Annotations — Temporal Descriptions — DONE
**Goal:** Build what CVAT doesn't have — text descriptions for frame ranges.

Built end-to-end and deployed. See `PHASE_2A_PROGRESS.md` for file-level references.

- [x] Data model: frame range + structured text description (`cvat/apps/engine/models.py::TemporalDescription` + migration `0099_temporaldescription`)
- [x] Backend: Django model, API endpoints, serializers, OPA policy (`cvat/apps/engine/rules/temporal_descriptions.rego`)
- [x] Frontend: React panel in the sidebar (`cvat-ui/src/components/annotation-page/standard-workspace/objects-side-bar/temporal-descriptions-list.tsx`)
- [x] Select a frame range via InputNumber + "Use current frame" buttons
- [x] Attach text description
- [x] Structured fields (action / intent / scene / objects)
- [x] Preview button that plays the exact segment, auto-pausing at frame_end
- [x] Export in Shofo Full format with absolute timestamps (frame/25fps)
- [ ] Nested/hierarchical descriptions (scene > action > detail) — deferred

**Note on quality comparison:** Temporal descriptions are intentionally NOT compared in the quality report pipeline — free-text can't be compared for equality. Only geometric annotations (shapes/tracks/tags) flow into GT conflict detection.

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

CVAT has the computation engine (accuracy/precision/recall + typed conflicts). What's missing in open-source is the UI — the paid version gates everything behind a paywall. We built our own.

- [x] Quality Control dashboard (`cvat-ui/src/components/quality-control/quality-overview-tab.tsx`)
  - Hero cards: Mean annotation quality, GT Conflicts (errors/warnings), Issues (resolved count)
  - GT job summary card
  - Per-annotation-job table (ID, Stage, Assignee, Coverage, Conflicts, Quality %, Actions)
  - Expandable conflict list per job — click frame # to jump to the exact shape in the right job (annotator's for "Extra", GT for "Missing")
  - Generate / Regenerate report button (POST /api/quality/reports)
- [x] Per-metric scoring — CVAT reports accuracy, precision, recall per job/task
- [ ] Per-labeler scoring — track accuracy over time (aggregate across tasks)
- [ ] Auto-routing — if labeler accuracy drops below threshold, flag for retraining
- [ ] Sampling — randomly sample N% of completed jobs for spot-check review
- [ ] Per-frame quality % on Management tab — deferred, revisit when multiple annotators per task

**Permissions note:** Out of the box, regular labelers (job assignees who aren't task staff) cannot view quality reports — `is_task_staff` gate in `cvat/apps/quality_control/rules/quality_reports.rego`. This is the right default: hides per-frame conflict data from labelers, which prevents "teach to the test" gaming of which frames are GT. Revisit if/when we want to give labelers self-feedback.

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
