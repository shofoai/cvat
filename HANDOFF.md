# Shofo CVAT Handoff

## Dev environment

- **VM:** `cvat` in GCP project `shofo-main`, zone `us-central1-a`, IP `34.45.70.26`, port `8080`
  - CPU-only (old GPU VM `34.10.161.153` disappeared and is gone)
  - SSH: `gcloud compute ssh cvat --zone=us-central1-a --project=shofo-main`
  - Repo cloned at `~/cvat` on the VM, branch `shofo/main`
- **Remote:** `shofo` on GitHub → `shofoai/cvat.git`. Branch `shofo/main` is the integration branch; `develop` tracks upstream CVAT.
- **Local rebuild:** `sudo docker compose -f docker-compose.yml -f docker-compose.dev.yml build cvat_ui` then `sudo docker compose up -d cvat_ui` (takes ~3-5 min)

## What shipped this session

### 1. Temporal descriptions (Phase 2A — brand new feature)

Text descriptions attached to frame ranges. CVAT has no equivalent.

Files:
- Backend model: `cvat/apps/engine/models.py::TemporalDescription`
- Migration: `cvat/apps/engine/migrations/0099_temporaldescription.py`
- Serializers: `cvat/apps/engine/serializers.py`
- Viewset: `cvat/apps/engine/views.py::TemporalDescriptionViewSet`
- URL: registered in `cvat/apps/engine/urls.py` at `/temporal-descriptions`
- Permissions: `cvat/apps/engine/permissions.py::TemporalDescriptionPermission` + OPA policy `cvat/apps/engine/rules/temporal_descriptions.rego`
- cvat-core: `cvat-core/src/server-proxy.ts` + `cvat-core/src/index.ts` (see `temporalDescriptions` namespace)
- UI: `cvat-ui/src/components/annotation-page/standard-workspace/objects-side-bar/temporal-descriptions-list.tsx` (sidebar tab: Add/Edit/Delete + play-preview)

Data shape: `{job, frame_start, frame_end, text, structured_fields}` where `structured_fields` is a JSON blob (currently action/intent/scene/objects).

### 2. Shofo Full export format

Custom exporter at `cvat/apps/dataset_manager/formats/shofo.py` — produces one JSON per task containing labels, shapes + tracks + tags, temporal descriptions with absolute timestamps (frame/25fps), and video metadata. Internal metadata stripped (no create/update dates, no job_id) so customers can't reverse-engineer our pipeline timing.

Registered in `cvat/apps/dataset_manager/formats/registry.py`.

Uses `CVAT_OUTPUT_FPS = 25.0` (CVAT internally re-encodes all videos to 25 FPS — see `cvat/apps/engine/media_extractors.py::_output_fps`).

### 3. Quality control dashboard (Phase 3B — initial slice)

Open-source CVAT stubs the Quality Overview tab behind a "premium feature" paywall. Built our own to replace it.

File: `cvat-ui/src/components/quality-control/quality-overview-tab.tsx`

Contents:
- Hero cards: Mean annotation quality, GT Conflicts (errors/warnings), Issues
- GT job summary card
- Per-annotation-job table: ID, Stage, Assignee, Coverage, Conflicts, Quality badge, Actions
- Expandable conflicts list per job — click a frame # to jump to the exact shape in the correct job:
  - "Extra annotation" → opens annotator's job (the extra shape is theirs)
  - "Missing annotation" → opens GT job (so reviewer sees what was missed)
  - "Mismatch" / "Low overlap" → opens annotator's job with the problematic shape pre-selected
- Generate/Regenerate report button (open-source UI never exposed this; we POST `/api/quality/reports` directly and auto-refresh at 30s/60s)

**Backend for this is all stock CVAT** — we only built the UI. `core.analytics.quality.reports(filter)` and `core.analytics.quality.conflicts({reportID})` are already plumbed.

**Permissions:** by default only task staff (task owner/assignee, project owner/assignee, admin) can view reports. Regular job assignees cannot. Gated in `cvat/apps/quality_control/rules/quality_reports.rego` via `is_task_staff`.

### 4. Sidebar tab order

Descriptions tab now appears before Issues in `cvat-ui/src/components/annotation-page/standard-workspace/objects-side-bar/objects-side-bar.tsx`.

---

## Things to redo from scratch

### SAM2 pipeline — WASH, start over

Previous approach produced **polygon annotations with frame-to-frame interpolation**, not real per-frame masks. Polygons + interpolation ≠ masks. Customers asking for segmentation want masks.

Full postmortem: [SAM2_IMPLEMENTATION_SUMMARY.md](SAM2_IMPLEMENTATION_SUMMARY.md). TL;DR of what to NOT repeat:

1. **Don't register SAM2 as a Nuclio tracker.** Nuclio's tracker protocol round-trips state (position/context) over HTTP between every frame. SAM2's internal state is hundreds of MB of GPU tensors — base64-encoding them to JSON blows past request size limits and is fragile with BFloat16 numpy serialization.
2. **Don't convert SAM2 masks to polygons** to shoehorn into CVAT's shape model. CVAT has a native `mask` shape type (bitmap) — target that instead. SAM2's output is already masks; keep it that way.
3. **The interactor pattern (`sam2/nuclio-interactor/`) worked for single-frame segmentation** — that's a fine reference. The tracker pattern (`sam2/nuclio/`) is what failed.
4. **Propagation should live in the Nuclio function, not round-trip per frame.** Send the initial prompt once, let the function process the whole video (or a chunk) server-side, return a sparse set of masks. Either store masks as a CVAT Track of `mask` shapes, or stream them back and let the UI hydrate incrementally.

Recommendation: fresh branch off `shofo/main`, keep `main.py` from the interactor as a starting point for single-frame SAM2, design the video-propagation path from scratch around native masks.

The old `shofo/sam2-tracking` branch is superseded by `shofo/main` (already contains the same commit) and will be deleted.

### GPU VM

Needs to be reprovisioned. The old `34.10.161.153` VM is gone.

Suggested setup: T4 or L4 GPU, reuse the same docker-compose setup that runs on CPU today. Once GPU is up:
1. Deploy Nuclio serverless platform
2. Deploy SAM2 (as masks, not polygons)
3. Optionally YOLO v7 for detection + TransT for bbox tracking (these already worked pre-disappearance)

---

## What might be worth building next

Rough priority for a labeling platform MVP:

1. **Redo SAM2 with mask output** (per above). Blocks any customer who wants segmentation.
2. **Workforce management (Phase 3A)** — time tracking, per-labeler productivity, deadlines. Derive from CVAT's existing ClickHouse events stream. Needed for pricing jobs and managing an actual labeling team.
3. **Per-labeler quality trends** — aggregate accuracy across tasks so you can identify strong/weak labelers. Backend metrics already exist per job; need a roll-up view.
4. **Client delivery portal** — how customers receive labeled data. Currently they'd get a Shofo Full JSON via export. Might want a dedicated UI/API for customers to pull deliverables.
5. **Flexible job creation** — CVAT currently only lets you add GT jobs to an existing task. Need to also allow adding annotation jobs with custom frame ranges (for consensus labeling + mid-project labeler additions).

Details for each are in `SHOFO_PLAN.md`.

---

## Gotchas

- **Claude's `.claude/` dir is local-only** — gitignored via `.claude/settings.json`, not checked in. Don't share personal auto-approve rules.
- **CVAT caches exports aggressively** — if an old export seems stale, delete `/home/django/data/cache/export/*taskid*` inside the `cvat_server` container.
- **Traefik routes by Host header** — when hitting the VM via IP, curl won't work as `localhost:8080` without `-H 'Host: 34.45.70.26'`.
- **`yarn install` needs a vendored yarn 4** — corepack blocked on the VM. There's a `yarn4.cjs` in the repo root we downloaded to bypass.
- **Reports are async** — POST `/api/quality/reports` returns 202 with an RQ job ID; the report becomes readable ~30-60s later. UI handles this via setTimeout refresh.

---

## File-level change log (this session)

```
cvat/apps/engine/models.py                         # +TemporalDescription
cvat/apps/engine/migrations/0099_temporaldescription.py   # new
cvat/apps/engine/serializers.py                    # +TemporalDescription{Read,Write}Serializer
cvat/apps/engine/views.py                          # +TemporalDescriptionViewSet
cvat/apps/engine/urls.py                           # +router.register
cvat/apps/engine/permissions.py                    # +TemporalDescriptionPermission
cvat/apps/engine/rules/temporal_descriptions.rego  # new OPA policy
cvat/apps/dataset_manager/formats/shofo.py         # new Shofo Full exporter
cvat/apps/dataset_manager/formats/registry.py      # +import shofo

cvat-core/src/server-proxy.ts                      # +temporalDescriptions CRUD
cvat-core/src/index.ts                             # +TemporalDescription namespace

cvat-ui/src/components/annotation-page/standard-workspace/objects-side-bar/
    objects-side-bar.tsx                           # +Descriptions tab, reorder
    temporal-descriptions-list.tsx                 # new component
cvat-ui/src/components/quality-control/
    quality-overview-tab.tsx                       # replaced paywall stub
    styles.scss                                    # +hero card styles

.claude/settings.json                              # local auto-approve config
```
