# Copyright (C) Shofo
#
# SPDX-License-Identifier: MIT

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from cvat.apps.dataset_manager.util import make_zip_archive
from cvat.apps.engine.models import DimensionType, Job, TemporalDescription

from .registry import exporter


def _resolve_task_and_jobs(instance_data):
    """Return (db_task, [db_jobs]) from a JobData / TaskData instance."""
    if hasattr(instance_data, "_db_job"):
        return instance_data._db_task, [instance_data._db_job]
    if hasattr(instance_data, "_db_task"):
        task = instance_data._db_task
        return task, list(Job.objects.filter(segment__task=task))
    return None, []


def _video_id_from_filename(filename: str) -> str:
    stem = Path(filename or "").stem
    return stem or "unknown"


def _serialize_labels(instance_data):
    out = []
    label_mapping = getattr(instance_data, "_label_mapping", None) or {}
    for label in label_mapping.values():
        out.append({
            "id": label.id,
            "name": label.name,
            "color": getattr(label, "color", None),
            "type": getattr(label, "type", None),
        })
    return out


def _serialize_shape(shape, label_name):
    return {
        "type": shape.type,
        "label": label_name,
        "frame": shape.frame,
        "points": list(shape.points),
        "rotation": getattr(shape, "rotation", 0),
        "occluded": getattr(shape, "occluded", False),
        "outside": getattr(shape, "outside", False),
        "z_order": getattr(shape, "z_order", 0),
        "group": getattr(shape, "group", 0),
        "attributes": [
            {"name": a.name, "value": a.value} for a in (shape.attributes or [])
        ],
    }


def _label_name_for(instance_data, label_id):
    label_mapping = getattr(instance_data, "_label_mapping", None) or {}
    label = label_mapping.get(label_id)
    return label.name if label else None


def _serialize_annotations(instance_data):
    shapes_out = []
    tracks_out = []
    tags_out = []

    for shape in instance_data.shapes:
        shapes_out.append(
            _serialize_shape(shape, _label_name_for(instance_data, shape.label))
        )

    for track in instance_data.tracks:
        tracks_out.append({
            "track_id": track.id,
            "label": _label_name_for(instance_data, track.label),
            "group": track.group,
            "shapes": [
                {
                    "type": s.type,
                    "frame": s.frame,
                    "points": list(s.points),
                    "occluded": s.occluded,
                    "outside": s.outside,
                    "keyframe": s.keyframe,
                    "rotation": getattr(s, "rotation", 0),
                    "z_order": getattr(s, "z_order", 0),
                    "attributes": [
                        {"name": a.name, "value": a.value} for a in (s.attributes or [])
                    ],
                }
                for s in track.shapes
            ],
        })

    for tag in instance_data.tags:
        tags_out.append({
            "frame": tag.frame,
            "label": _label_name_for(instance_data, tag.label),
            "attributes": [
                {"name": a.name, "value": a.value} for a in (tag.attributes or [])
            ],
        })

    return {"shapes": shapes_out, "tracks": tracks_out, "tags": tags_out}


def _serialize_video_metadata(db_task):
    data = getattr(db_task, "data", None)
    video = getattr(data, "video", None) if data else None
    source_filename = None
    for f in (data.client_files.all() if data else []):
        source_filename = os.path.basename(f.file.name)
        break

    if not source_filename and video:
        source_filename = os.path.basename(video.path or "")

    return {
        "source_filename": source_filename,
        "frame_count": data.size if data else None,
        "start_frame": data.start_frame if data else None,
        "stop_frame": data.stop_frame if data else None,
        "width": video.width if video else None,
        "height": video.height if video else None,
        "resolution": f"{video.width}x{video.height}" if video else None,
    }


def _serialize_temporal_descriptions(db_jobs):
    if not db_jobs:
        return []
    job_ids = [j.id for j in db_jobs]
    descs = TemporalDescription.objects.filter(job_id__in=job_ids).order_by(
        "frame_start", "id"
    )
    out = []
    for d in descs:
        out.append({
            "id": d.id,
            "job_id": d.job_id,
            "frame_start": d.frame_start,
            "frame_end": d.frame_end,
            "text": d.text,
            "structured_fields": d.structured_fields or {},
            "created_date": d.created_date.isoformat() if d.created_date else None,
            "updated_date": d.updated_date.isoformat() if d.updated_date else None,
        })
    return out


def _export_shofo_full(dst_file, temp_dir, instance_data, save_images=False):
    db_task, db_jobs = _resolve_task_and_jobs(instance_data)

    video_meta = _serialize_video_metadata(db_task) if db_task else {}
    source_filename = video_meta.get("source_filename") or ""
    shofo_video_id = _video_id_from_filename(source_filename)

    payload = {
        "shofo_video_id": shofo_video_id,
        "source_filename": source_filename,
        "task": {
            "id": db_task.id if db_task else None,
            "name": db_task.name if db_task else None,
            "mode": db_task.mode if db_task else None,
        },
        "video_metadata": video_meta,
        "labels": _serialize_labels(instance_data),
        "annotations": _serialize_annotations(instance_data),
        "temporal_descriptions": _serialize_temporal_descriptions(db_jobs),
        "export_date": datetime.now(timezone.utc).isoformat(),
        "format_version": "shofo-full-1.0",
    }

    annotations_dir = Path(temp_dir) / "annotations"
    annotations_dir.mkdir(parents=True, exist_ok=True)
    out_path = annotations_dir / f"{shofo_video_id}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    make_zip_archive(temp_dir, dst_file)


exporter(
    name="Shofo Full",
    ext="ZIP",
    version="1.0",
    dimension=DimensionType.DIM_2D,
)(_export_shofo_full)
