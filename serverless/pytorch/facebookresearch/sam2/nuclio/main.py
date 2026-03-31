import base64
import collections
import io
import json

import cv2
import numpy as np
import torch
import torchvision.transforms
from PIL import Image
from sam2.sam2_video_predictor import SAM2VideoPredictor
from sam2.utils.misc import fill_holes_in_mask_scores


class Sam2TrackerHandler:
    def __init__(self):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        if self.device.type == "cuda":
            torch.set_autocast_enabled(True)
            torch.set_autocast_gpu_dtype(torch.bfloat16)
            if torch.cuda.get_device_properties(self.device).major >= 8:
                torch.backends.cuda.matmul.allow_tf32 = True
                torch.backends.cudnn.allow_tf32 = True

        self.predictor = SAM2VideoPredictor.from_pretrained(
            "facebook/sam2.1-hiera-tiny", device=self.device
        )
        self.transform = torchvision.transforms.Compose([
            torchvision.transforms.Resize(
                (self.predictor.image_size, self.predictor.image_size)
            ),
            torchvision.transforms.ToTensor(),
            torchvision.transforms.Normalize(
                mean=(0.485, 0.456, 0.406),
                std=(0.229, 0.224, 0.225),
            ),
        ])

    def _preprocess_image(self, image):
        image_tensor = self.transform(image).unsqueeze(0).to(device=self.device)
        backbone_out = self.predictor.forward_image(image_tensor)
        vision_feats = backbone_out["backbone_fpn"][-self.predictor.num_feature_levels:]
        vision_pos_embeds = backbone_out["vision_pos_enc"][-self.predictor.num_feature_levels:]

        return {
            "width": image.width,
            "height": image.height,
            "vision_feats": [x.flatten(2).permute(2, 0, 1) for x in vision_feats],
            "vision_pos_embeds": [x.flatten(2).permute(2, 0, 1) for x in vision_pos_embeds],
            "feat_sizes": [(x.shape[-2], x.shape[-1]) for x in vision_pos_embeds],
        }

    def _shape_to_mask(self, shape, width, height):
        # CVAT sends shape as a dict with "type" and "points" when supported_shape_types is declared
        # or as a flat list for legacy functions
        mask = np.zeros((height, width), dtype=np.uint8)

        if isinstance(shape, dict):
            shape_type = shape.get("type", "rectangle")
            points = shape.get("points", [])
        elif isinstance(shape, list):
            # Legacy format: flat list of coordinates
            points = shape
            shape_type = "rectangle" if len(points) == 4 else "polygon"
        else:
            return mask

        if shape_type == "rectangle" and len(points) >= 4:
            x1, y1, x2, y2 = [int(p) for p in points[:4]]
            x1, x2 = max(0, min(x1, width)), max(0, min(x2, width))
            y1, y2 = max(0, min(y1, height)), max(0, min(y2, height))
            mask[y1:y2, x1:x2] = 1
        elif shape_type == "polygon" and len(points) >= 6:
            pts = np.array(points, dtype=np.int32).reshape((-1, 2))
            cv2.fillPoly(mask, [pts], 1)
        elif shape_type == "mask" and len(points) > 0:
            # RLE-encoded mask: last 2 values are left/top offset
            rle = points[:-2]
            left, top = int(points[-2]), int(points[-1])
            rle_width = int(rle[0]) if len(rle) > 0 else width
            rle_height = int(rle[1]) if len(rle) > 1 else height
            rle_data = rle[2:] if len(rle) > 2 else rle
            offset = 0
            flat = np.zeros(rle_width * rle_height, dtype=np.uint8)
            for i, count in enumerate(rle_data):
                count = int(count)
                if i % 2 == 1:
                    flat[offset:offset + count] = 1
                offset += count
            rle_mask = flat.reshape((rle_height, rle_width))
            # Place in full image
            end_y = min(top + rle_height, height)
            end_x = min(left + rle_width, width)
            mask[top:end_y, left:end_x] = rle_mask[:end_y-top, :end_x-left]
        else:
            # Fallback: treat as polygon or bbox
            if len(points) >= 4:
                pts = np.array(points, dtype=np.int32).reshape((-1, 2))
                x1, y1 = pts.min(axis=0)
                x2, y2 = pts.max(axis=0)
                mask[max(0,y1):min(height,y2), max(0,x1):min(width,x2)] = 1

        return mask

    def _mask_to_polygon(self, mask):
        contours, _ = cv2.findContours(
            mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        if not contours:
            return None
        largest = max(contours, key=cv2.contourArea)
        approx = cv2.approxPolyDP(largest, epsilon=1.0, closed=True)
        if approx.shape[0] < 3:
            return None
        return {"type": "polygon", "points": approx.flatten().tolist()}

    def _mask_to_rectangle(self, mask):
        ys, xs = np.where(mask > 0)
        if len(xs) == 0:
            return None
        return {"type": "rectangle", "points": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]}

    def _mask_to_shape(self, mask, original_shape):
        if isinstance(original_shape, dict):
            orig_type = original_shape.get("type", "rectangle")
        else:
            orig_type = "rectangle"

        if orig_type in ("polygon", "mask"):
            return self._mask_to_polygon(mask)
        else:
            return self._mask_to_rectangle(mask)

    @torch.inference_mode()
    def infer(self, image, shape, state):
        pp = self._preprocess_image(image)

        if state is None:
            mask = self._shape_to_mask(shape, pp["width"], pp["height"])
            resized_mask = torch.nn.functional.interpolate(
                torch.from_numpy(mask).float()[None, None],
                (self.predictor.image_size, self.predictor.image_size),
                mode="bilinear",
                align_corners=False,
            )
            resized_mask = (resized_mask >= 0.5).float().to(device=self.device)

            current_out = self.predictor.track_step(
                current_vision_feats=pp["vision_feats"],
                current_vision_pos_embeds=pp["vision_pos_embeds"],
                feat_sizes=pp["feat_sizes"],
                point_inputs=None,
                frame_idx=0,
                num_frames=1,
                is_init_cond_frame=True,
                mask_inputs=resized_mask,
                output_dict={},
            )

            new_state = {
                "frame_idx": 0,
                "cond_frame_outputs": {"0": self._serialize_output(current_out)},
                "non_cond_frame_outputs": {},
            }
            return shape, new_state
        else:
            frame_idx = state["frame_idx"] + 1

            output_dict = {
                "cond_frame_outputs": {
                    int(k): self._deserialize_output(v)
                    for k, v in state["cond_frame_outputs"].items()
                },
                "non_cond_frame_outputs": collections.OrderedDict(
                    (int(k), self._deserialize_output(v))
                    for k, v in state.get("non_cond_frame_outputs", {}).items()
                ),
            }

            current_out = self.predictor.track_step(
                current_vision_feats=pp["vision_feats"],
                current_vision_pos_embeds=pp["vision_pos_embeds"],
                feat_sizes=pp["feat_sizes"],
                point_inputs=None,
                frame_idx=frame_idx,
                num_frames=frame_idx + 1,
                is_init_cond_frame=False,
                mask_inputs=None,
                output_dict=output_dict,
            )

            pred_masks = fill_holes_in_mask_scores(
                current_out["pred_masks"], self.predictor.fill_hole_area
            )
            output_mask = torch.nn.functional.interpolate(
                pred_masks,
                size=(pp["height"], pp["width"]),
                align_corners=False,
                mode="bilinear",
                antialias=True,
            )[0, 0] > 0

            non_cond = state.get("non_cond_frame_outputs", {})
            non_cond[str(frame_idx)] = self._serialize_output(current_out)

            keys = sorted(non_cond.keys(), key=int)
            while len(keys) > self.predictor.num_maskmem:
                del non_cond[keys.pop(0)]

            new_state = {
                "frame_idx": frame_idx,
                "cond_frame_outputs": state["cond_frame_outputs"],
                "non_cond_frame_outputs": non_cond,
            }

            result_shape = self._mask_to_shape(output_mask.cpu().numpy(), shape)

            if result_shape is None:
                return shape, new_state

            return result_shape, new_state

    def _serialize_output(self, out):
        result = {}
        for k, v in out.items():
            if isinstance(v, torch.Tensor):
                # Convert bfloat16 to float32 for numpy compatibility
                t = v.cpu()
                if t.dtype == torch.bfloat16:
                    t = t.float()
                result[k] = base64.b64encode(t.numpy().tobytes()).decode("utf-8")
                result[k + "_shape"] = list(t.shape)
                result[k + "_dtype"] = str(t.dtype).replace("torch.", "")
            elif isinstance(v, list) and len(v) > 0 and isinstance(v[0], torch.Tensor):
                tensors = []
                for t in v:
                    t = t.cpu()
                    if t.dtype == torch.bfloat16:
                        t = t.float()
                    tensors.append(t)
                result[k] = [
                    base64.b64encode(t.numpy().tobytes()).decode("utf-8") for t in tensors
                ]
                result[k + "_shapes"] = [list(t.shape) for t in tensors]
                result[k + "_dtype"] = str(tensors[0].dtype).replace("torch.", "")
            else:
                result[k] = v
        return result

    def _deserialize_output(self, data):
        result = {}
        skip_keys = set()
        for k, v in data.items():
            if k.endswith("_shape") or k.endswith("_shapes") or k.endswith("_dtype"):
                skip_keys.add(k)
                continue

            shape_key = k + "_shape"
            shapes_key = k + "_shapes"
            dtype_key = k + "_dtype"

            if shape_key in data:
                dtype = getattr(torch, data[dtype_key])
                np_dtype = torch.zeros(1, dtype=dtype).numpy().dtype
                arr = np.frombuffer(base64.b64decode(v), dtype=np_dtype)
                result[k] = torch.from_numpy(arr.reshape(data[shape_key]).copy()).to(device=self.device)
            elif shapes_key in data:
                dtype = getattr(torch, data[dtype_key])
                np_dtype = torch.zeros(1, dtype=dtype).numpy().dtype
                result[k] = [
                    torch.from_numpy(
                        np.frombuffer(base64.b64decode(item), dtype=np_dtype).reshape(shape).copy()
                    ).to(device=self.device)
                    for item, shape in zip(v, data[shapes_key])
                ]
            elif k not in skip_keys:
                result[k] = v

        return result


def init_context(context):
    context.logger.info("Init context...  0%")
    context.user_data.model = Sam2TrackerHandler()
    context.logger.info("Init context...100%")


def handler(context, event):
    context.logger.info("Run SAM2 Tracker")
    data = event.body
    buf = io.BytesIO(base64.b64decode(data["image"]))
    shapes = data.get("shapes", [])
    states = data.get("states", [])

    image = Image.open(buf).convert("RGB")

    results = {"shapes": [], "states": []}
    for i, shape in enumerate(shapes):
        result_shape, result_state = context.user_data.model.infer(
            image, shape, states[i] if i < len(states) else None
        )
        results["shapes"].append(result_shape)
        results["states"].append(result_state)

    return context.Response(
        body=json.dumps(results), headers={}, content_type="application/json", status_code=200
    )
