# Inference API

YOLOv10 object detection inference API powered by Hailo-8.

Base URL: `https://yolo.homeprem.no`

## Authentication

All endpoints require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <token>
```

Requests without a valid token receive `401 Unauthorized`.

## Endpoints

### POST /api/v1/infer

Run inference on an image.

**Request** (multipart form):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | file | yes | Image file (JPEG, PNG, etc.) |
| `project_id` | string | yes | Project ID (e.g. `fac23eeac522`) |
| `conf` | float | no | Confidence threshold (default `0.25`) |

**Example:**

```bash
curl -X POST https://yolo.homeprem.no/api/v1/infer \
  -H "Authorization: Bearer <token>" \
  -F "file=@photo.jpg" \
  -F "project_id=fac23eeac522" \
  -F "conf=0.3"
```

**Response:**

```json
{
  "job_id": "a1b2c3d4e5f6",
  "detections": [
    {
      "class_id": 0,
      "class_name": "tank",
      "confidence": 0.92,
      "x1": 120.5,
      "y1": 80.3,
      "x2": 450.2,
      "y2": 310.7,
      "source": "custom"
    },
    {
      "class_id": 2,
      "class_name": "car",
      "confidence": 0.71,
      "x1": 500.0,
      "y1": 200.0,
      "x2": 680.0,
      "y2": 350.0,
      "source": "pretrained"
    }
  ],
  "image_width": 1024,
  "image_height": 768,
  "inference_time_ms": 62.7
}
```

| Field | Description |
|-------|-------------|
| `job_id` | Unique ID for retrieving cached images |
| `detections` | Array of detected objects |
| `detections[].class_id` | Numeric class index |
| `detections[].class_name` | Human-readable class name |
| `detections[].confidence` | Detection confidence (0-1) |
| `detections[].x1, y1, x2, y2` | Bounding box in original image pixel coordinates |
| `detections[].source` | `"custom"` (project model) or `"pretrained"` (COCO model) |
| `image_width` | Original image width in pixels |
| `image_height` | Original image height in pixels |
| `inference_time_ms` | Server-side inference time in milliseconds |

---

### GET /api/v1/jobs/{job_id}/raw

Fetch the original uploaded image.

```bash
curl -H "Authorization: Bearer <token>" \
  https://yolo.homeprem.no/api/v1/jobs/a1b2c3d4e5f6/raw -o raw.jpg
```

Returns `image/jpeg`. Returns `404` if the job has expired.

---

### GET /api/v1/jobs/{job_id}/annotated

Fetch the image with detection boxes drawn on it (green = custom model, blue = pretrained model).

```bash
curl -H "Authorization: Bearer <token>" \
  https://yolo.homeprem.no/api/v1/jobs/a1b2c3d4e5f6/annotated -o annotated.jpg
```

Returns `image/jpeg`. Returns `404` if the job has expired.

---

### GET /api/v1/status

Check engine status.

```bash
curl -H "Authorization: Bearer <token>" https://yolo.homeprem.no/api/v1/status
```

**Response:**

```json
{
  "loaded_project": "fac23eeac522",
  "uptime_seconds": 3421.5,
  "dual_model": true,
  "img_size": 640,
  "queue_length": 0
}
```

| Field | Description |
|-------|-------------|
| `loaded_project` | Currently loaded project ID, or `null` if none |
| `uptime_seconds` | Seconds since server started |
| `dual_model` | Whether both custom + COCO models are active |
| `img_size` | Model input resolution |
| `queue_length` | Number of inference requests currently in-flight or waiting |

## Notes

- Inference requests are serialized. Concurrent requests queue and `queue_length` reflects the current depth.
- The first request for a project is slower (loads models). Subsequent requests reuse the warm pipeline.
- Switching `project_id` between requests reloads the pipeline.
- Job results (cached images) expire after 10 minutes.
