# CVAT Overview for Shofo — What We Know So Far

## What CVAT Is
Open source video/image annotation platform (MIT license). We self-host it instead of paying for Encord ($30k+ base + $1,500/seat/month). Our cost: ~$1.40/hr for a GPU server when running, ~$8/month when stopped.

---

## How It's Organized
- **Project** — a container for related work (e.g., "Client X - Human Detection"). Defines labels, annotation guides
- **Task** — a single video uploaded into a project
- **Job** — a unit of work assigned to a labeler. Long videos get split into multiple jobs
- **Stages** — each job flows: Annotation → Validation → Acceptance
- **States** — New → In Progress → Completed → Rejected (reviewers can reject and send back)

---

## What Works Well Out of the Box
- **Bounding boxes with tracking** — draw a box, jump forward, adjust, CVAT interpolates all frames between
- **Skeleton annotation** — define joint templates (head, shoulders, elbows, etc.) for kinematic labeling - want to automate this with models think it should be fairly doable
- **Tags & attributes** — label entire frames with categories, add metadata (dropdowns, text fields) to any annotation
- **Team management** — Organizations with roles (Owner, Maintainer, Supervisor, Worker). Assign jobs to specific people
- **Review workflow** — reviewer opens a job, pins issues to specific frames with comments, approves or rejects
- **Annotation guides** — markdown instructions with images that labelers see when they open a job
- **Export** — COCO JSON, YOLO, Pascal VOC, and 15+ other formats. Includes track IDs so customers know which annotations belong to the same object across frames
- **AI models via Nuclio** — deploy YOLO, SAM, tracking models as serverless functions. They show up in the UI for labelers to use
- **API + SDK** — everything can be automated programmatically

---

## AI Models We've Deployed (on GCP with T4 GPU)
- **YOLO v7** — auto-detects all people/objects across every frame. Zero human input needed
- **SAM (Segment Anything)** — click once on a person, get a precise segmentation mask instantly
- **TransT** — tracks bounding boxes across frames (not masks)
- **SAM2** — deployed but not fully working yet (see blockers below)

---

## Current Blockers / Things We Need to Build

### 1. SAM2 mask tracking across frames (IN PROGRESS)
SAM1 segments perfectly on a single frame. SAM2 is deployed but we need to wire it up so you click once and it tracks the segmentation mask across the entire video. Currently being worked on.

### 2. No frame-range text annotation
CVAT has no way to select frames 100-350 and write "Bryan walks toward camera while talking." Tags exist but they're per-frame with no range support and the text fields are hidden in the sidebar. We need to build a custom temporal description system — this is the biggest custom engineering task.

### 3. Playback speed is slow
Scrubbing through a 2-min video takes 10+ minutes. The video plays back frame-by-frame, not at native speed. This needs investigation — may be a configuration issue or may need frontend work.

### 4. No audio
CVAT strips audio from videos since it's designed for visual annotation. If we need audio for our annotation tasks, we'd need to add an audio player component synced to the video frames.

### 5. Auto-annotation speed
CVAT processes frames one at a time when running YOLO auto-annotation (~4fps). Claude built a full optimization plan to get this to ~25-30fps through parallel processing.

### 6. Quality control / ground truth
CVAT's backend supports ground truth jobs and quality scoring, but the dashboard UI is paywalled (premium feature). The backend works or claude claims it does — we need to build our own dashboard to display the results.

### 7. Workforce management
No built-in time tracking, deadlines, labeler performance dashboards, or billing. The event data exists in ClickHouse (CVAT logs everything), so we'd build dashboards on top of that.

---

## The Build Plan (Phases)

| Phase | What | Status |
|-------|------|--------|
| 1A | Learn CVAT features | Done |
| 1B | Deploy on GCP with GPU + AI models | ~90% done (SAM2 tracking remaining) |
| 1C | Batch pipeline for millions of videos | Not started |
| 2A | Custom temporal text annotations | Not started (biggest custom build) |
| 2B | Advanced kinematic labeling | Not started |
| 3A | Workforce management (time tracking, dashboards) | Not started |
| 3B | Quality control (F1 scoring, ground truth) | Not started |
| 3C | Team management (onboarding, permissions) | Not started |
| 4 | Client delivery portal | Not started |

---

## Cost Comparison
- **Encord:** $30k base + $1,500/seat/month. 10 labelers = $210k/year
- **CVAT self-hosted:** ~$5-15k/year infrastructure + engineering time
- **GPU costs for auto-annotation:** ~$2,000-5,000 per million videos

---

## Key Files
- `SHOFO_PLAN.md` — full build plan with checkboxes
- `OPTIMIZATION_PLAN.md` — detailed plan for speeding up auto-annotation
