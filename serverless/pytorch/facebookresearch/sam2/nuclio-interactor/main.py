import base64
import io
import json

import numpy as np
import torch
from PIL import Image
from sam2.sam2_image_predictor import SAM2ImagePredictor


def init_context(context):
    context.logger.info("Init context...  0%")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    if device.type == "cuda":
        torch.set_autocast_enabled(True)
        torch.set_autocast_gpu_dtype(torch.bfloat16)
        if torch.cuda.get_device_properties(device).major >= 8:
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True

    predictor = SAM2ImagePredictor.from_pretrained("facebook/sam2.1-hiera-tiny")
    predictor.model.to(device)

    context.user_data.predictor = predictor
    context.user_data.device = device

    context.logger.info("Init context...100%")


def _mask_to_rle(mask):
    """Convert a 2D binary mask to CVAT interactor RLE format.

    CVAT expects: [...rle_counts, left, top, right, bottom]
    where:
    - rle_counts encode the CROPPED mask (bounding box region only)
    - rle_counts alternate between 0-counts and 1-counts, starting with 0s
    - last 4 values are the bounding box: left, top, right, bottom
    - CVAT decodes with width = right - left + 1, height = bottom - top + 1
    """
    if not mask.any():
        return [0, 0, 0, 0]

    # Find bounding box of the mask
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    top = int(np.argmax(rows))
    bottom = int(len(rows) - 1 - np.argmax(rows[::-1]))
    left = int(np.argmax(cols))
    right = int(len(cols) - 1 - np.argmax(cols[::-1]))

    # Crop mask to bounding box
    cropped = mask[top:bottom + 1, left:right + 1]

    # Flatten cropped mask in row-major order
    flat = cropped.flatten().astype(np.uint8)

    # Run-length encode, always starting with count of 0s
    rle_counts = []
    current_val = 0
    count = 0

    for val in flat:
        if val == current_val:
            count += 1
        else:
            rle_counts.append(count)
            current_val = val
            count = 1

    rle_counts.append(count)

    # If mask starts with 1 (foreground), prepend a 0-count of 0
    if flat[0] > 0:
        rle_counts = [0] + rle_counts

    # Append bounding box: left, top, right, bottom
    result = [int(c) for c in rle_counts] + [int(left), int(top), int(right), int(bottom)]
    return result


@torch.inference_mode()
def handler(context, event):
    context.logger.info("Run SAM2 Interactor")

    data = event.body
    predictor = context.user_data.predictor

    # Decode image
    buf = io.BytesIO(base64.b64decode(data["image"]))
    image = Image.open(buf).convert("RGB")
    image_np = np.array(image)

    # Parse points
    pos_points = data.get("pos_points", [])
    neg_points = data.get("neg_points", [])
    obj_bbox = data.get("obj_bbox", None)

    context.logger.info(f"Image size: {image_np.shape}, pos_points: {pos_points}, neg_points: {neg_points}, obj_bbox: {obj_bbox}")

    # Set image
    predictor.set_image(image_np)

    # Build prompt inputs
    point_coords = None
    point_labels = None
    box = None

    if pos_points or neg_points:
        coords = []
        labels = []
        for pt in pos_points:
            coords.append([pt[0], pt[1]])
            labels.append(1)
        for pt in neg_points:
            coords.append([pt[0], pt[1]])
            labels.append(0)
        point_coords = np.array(coords, dtype=np.float32)
        point_labels = np.array(labels, dtype=np.int32)

    if obj_bbox:
        # obj_bbox is [[x1, y1], [x2, y2]]
        x1, y1 = obj_bbox[0]
        x2, y2 = obj_bbox[1]
        box = np.array([x1, y1, x2, y2], dtype=np.float32)

    # Run prediction
    masks, scores, _ = predictor.predict(
        point_coords=point_coords,
        point_labels=point_labels,
        box=box,
        multimask_output=True,
    )

    # Handle bfloat16: convert to float32 before numpy operations
    if isinstance(masks, torch.Tensor):
        if masks.dtype == torch.bfloat16:
            masks = masks.float()
        masks = masks.cpu().numpy()

    if isinstance(scores, torch.Tensor):
        if scores.dtype == torch.bfloat16:
            scores = scores.float()
        scores = scores.cpu().numpy()

    # Select best mask
    best_idx = int(np.argmax(scores))
    best_mask = masks[best_idx]
    best_score = float(scores[best_idx])

    # Convert mask to binary
    binary_mask = (best_mask > 0.5).astype(np.uint8)

    # Encode as CVAT RLE
    rle_points = _mask_to_rle(binary_mask)

    result = {
        "shapes": [{
            "confidence": best_score,
            "label": "",
            "points": rle_points,
            "type": "mask",
        }]
    }

    return context.Response(
        body=json.dumps(result),
        headers={},
        content_type="application/json",
        status_code=200,
    )
