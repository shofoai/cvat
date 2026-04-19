# Phase 2A — Temporal Text Descriptions (progress)

## Status: MVP code complete, untested

End of day 2026-04-18. User was low energy — worked autonomously.

## What's built

### Backend (Django + DRF)
- [cvat/apps/engine/models.py:1515](cvat/apps/engine/models.py#L1515) — `TemporalDescription` model (job FK, frame_start, frame_end, text, structured_fields JSONField, owner, timestamps)
- [cvat/apps/engine/migrations/0099_temporaldescription.py](cvat/apps/engine/migrations/0099_temporaldescription.py) — migration
- [cvat/apps/engine/serializers.py](cvat/apps/engine/serializers.py) — `TemporalDescriptionReadSerializer` + `TemporalDescriptionWriteSerializer`
- [cvat/apps/engine/views.py](cvat/apps/engine/views.py) — `TemporalDescriptionViewSet` with list/create/retrieve/update/destroy
- [cvat/apps/engine/urls.py:22](cvat/apps/engine/urls.py#L22) — `/api/temporal-descriptions` route
- [cvat/apps/engine/permissions.py](cvat/apps/engine/permissions.py) — `TemporalDescriptionPermission` (OPA-backed, same shape as IssuePermission)
- [cvat/apps/engine/rules/temporal_descriptions.rego](cvat/apps/engine/rules/temporal_descriptions.rego) — access policy, cloned from issues.rego

### cvat-core
- [cvat-core/src/server-proxy.ts](cvat-core/src/server-proxy.ts) — `temporalDescriptions.{get,create,update,delete}`
- [cvat-core/src/index.ts](cvat-core/src/index.ts) — `TemporalDescription` type + namespace in `CVATCore` interface
- [cvat-core/src/api.ts](cvat-core/src/api.ts) — PluginRegistry wrappers
- [cvat-core/src/api-implementation.ts](cvat-core/src/api-implementation.ts) — serverProxy delegation

### cvat-ui
- [cvat-ui/src/components/annotation-page/standard-workspace/objects-side-bar/temporal-descriptions-list.tsx](cvat-ui/src/components/annotation-page/standard-workspace/objects-side-bar/temporal-descriptions-list.tsx) — new panel component with Add/Edit/Delete, frame range inputs, free text, structured fields (action/intent/scene/objects), click to jump-to-frame
- [cvat-ui/src/components/annotation-page/standard-workspace/objects-side-bar/objects-side-bar.tsx](cvat-ui/src/components/annotation-page/standard-workspace/objects-side-bar/objects-side-bar.tsx) — wired in as new "Descriptions" tab
- [cvat-ui/src/cvat-core-wrapper.ts](cvat-ui/src/cvat-core-wrapper.ts) — re-exports `TemporalDescription` type

## What's NOT done
- Export flow: temporal descriptions aren't included in COCO/JSON exports yet. Needs hook in `cvat/apps/dataset_manager/bindings.py`. Deferred.
- End-to-end test: GPU VM was off during build — nothing has been run against real backend.

## Tomorrow's startup checklist
1. Start GCP VM
2. Get IP: `gcloud compute instances describe cvat-gpu --zone=us-central1-a --format="get(networkInterfaces[0].accessConfigs[0].natIP)"`
3. Build UI image: `docker compose -f docker-compose.yml -f docker-compose.dev.yml build cvat_ui` (or rebuild the changed services)
4. Run migration: `docker exec cvat_server python manage.py migrate`
5. Open Bryan task in browser → annotation workspace → right sidebar → new "Descriptions" tab
6. Test Add → set frame range → enter text → Save → reload page → verify persists
7. Click a description → verify jumps to frame
8. Test edit + delete

## Known issues / assumptions to verify
- **OPA rego policy**: may need a rebuild of the OPA bundle if it doesn't auto-pick up new files. Check container logs on first API call.
- **JSONField on default_permissions=()**: should be fine but verify admin UI renders OK.
- **structured_fields ordering**: current UI hardcodes ["action","intent","scene","objects"] — will extend based on what feels natural after testing.

## Next features (Phase 2A polish)
- Export hook for JSON/COCO format
- Keyboard shortcut to create description from current frame
- Hierarchical descriptions (scene → action → detail)
- Overlap detection on frame ranges (warn if ranges overlap)
