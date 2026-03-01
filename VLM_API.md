# VLM API

Vision Language Model inference API powered by vLLM with continuous batching.

Base URL: `https://vision.homeprem.no`

## Overview

This service provides vision language model inference using Qwen2.5-VL-7B-AWQ. The underlying vLLM engine supports **continuous batching**, meaning concurrent requests are processed efficiently by dynamically batching at the token level rather than queuing sequentially.

## Authentication

All endpoints require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <token>
```

Requests without a valid token receive `401 Unauthorized`.

## Endpoints

### POST /api/v1/categorize

Run inference on a single image.

**Request** (multipart form):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | file | yes | Image file (JPEG, PNG, etc.) |
| `prompt` | string | no | Custom prompt (default: categorization prompt) |
| `max_tokens` | int | no | Maximum tokens to generate (default `1024`) |

**Example:**

```bash
curl -X POST https://vision.homeprem.no/api/v1/categorize \
  -H "Authorization: Bearer <token>" \
  -F "file=@photo.jpg" \
  -F "prompt=Describe this image briefly."
```

**Response:**

```json
{
  "job_id": "a1b2c3d4e5f6",
  "response": "The image shows a snowy road with vehicles traveling through a winter landscape...",
  "inference_time_ms": 892.3,
  "prompt_tokens": 52,
  "completion_tokens": 87,
  "total_tokens": 139
}
```

| Field | Description |
|-------|-------------|
| `job_id` | Unique identifier for this request |
| `response` | Model's text response |
| `inference_time_ms` | Server-side inference time in milliseconds |
| `prompt_tokens` | Number of input tokens (text + image) |
| `completion_tokens` | Number of generated tokens |
| `total_tokens` | Total tokens processed |

---

### GET /api/v1/jobs/{job_id}/raw

Fetch the original uploaded image.

**Example:**

```bash
curl -H "Authorization: Bearer <token>" \
  https://vision.homeprem.no/api/v1/jobs/a1b2c3d4e5f6/raw -o raw.jpg
```

Returns `image/jpeg` (or original content type). Returns `404` if the job has expired.

**Note:** Job results expire after 10 minutes.

---

### POST /api/v1/benchmark

Run inference on multiple images with different processing modes.

**Request** (multipart form):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `images` | file[] | yes | One or more image files |
| `prompt` | string | no | Custom prompt (default: categorization prompt) |
| `mode` | string | no | `concurrent`, `sequential`, or `simulate` (default `concurrent`) |
| `min_delay` | float | no | Minimum delay in seconds for simulate mode (default `1`) |
| `max_delay` | float | no | Maximum delay in seconds for simulate mode (default `3`) |

**Modes:**

- **concurrent**: Send all images simultaneously. Tests vLLM continuous batching throughput.
- **sequential**: Process images one at a time. Baseline for comparison.
- **simulate**: Stagger requests with random delays between `min_delay` and `max_delay` seconds. Simulates real-world traffic patterns.

**Example:**

```bash
curl -X POST https://vision.homeprem.no/api/v1/benchmark \
  -H "Authorization: Bearer <token>" \
  -F "images=@photo1.jpg" \
  -F "images=@photo2.jpg" \
  -F "images=@photo3.jpg" \
  -F "prompt=Describe briefly." \
  -F "mode=concurrent"
```

**Response:**

```json
{
  "mode": "concurrent",
  "image_count": 3,
  "total_time_ms": 1245.6,
  "avg_time_ms": 415.2,
  "throughput": 2.41,
  "sequential_estimate_ms": 2890.3,
  "results": [
    {
      "success": true,
      "image_id": "0",
      "response": "A snowy mountain road with vehicles...",
      "inference_time_ms": 892.3,
      "prompt_tokens": 52,
      "completion_tokens": 45,
      "total_tokens": 97,
      "timestamp": "2026-03-01T16:30:00.123456"
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `mode` | Processing mode used |
| `image_count` | Number of images processed |
| `total_time_ms` | Wall-clock time for entire batch |
| `avg_time_ms` | Average inference time per image |
| `throughput` | Images processed per second |
| `sequential_estimate_ms` | Sum of individual inference times (for concurrent/simulate modes) |
| `results` | Array of per-image results |

**Simulate mode additional fields:**

```json
{
  "timeline": [
    {"sent_at": 0.0, "duration": 892.3},
    {"sent_at": 1523.4, "duration": 756.2},
    {"sent_at": 3891.0, "duration": 641.8}
  ],
  "max_concurrent": 2
}
```

| Field | Description |
|-------|-------------|
| `timeline` | When each request was sent (offset in ms) and how long it took |
| `max_concurrent` | Maximum number of overlapping requests during the test |

---

### GET /api/v1/status

Check server and vLLM engine status.

**Example:**

```bash
curl https://vision.homeprem.no/api/v1/status
```

**Note:** This endpoint does not require authentication.

**Response:**

```json
{
  "vllm_status": "online",
  "model": "Qwen/Qwen2.5-VL-7B-Instruct-AWQ",
  "uptime_seconds": 3421.5,
  "requests_served": 147,
  "total_tokens_generated": 12450,
  "cached_jobs": 3,
  "max_tokens": 1024,
  "vllm_endpoint": "http://localhost:8000",
  "error": null,
  "gpu": {
    "gpu_name": "NVIDIA GeForce RTX 3060",
    "gpu_utilization_percent": 45,
    "memory_used_mb": 9842,
    "memory_total_mb": 12288,
    "memory_percent": 80.1,
    "temperature_c": 62
  }
}
```

| Field | Description |
|-------|-------------|
| `vllm_status` | `"online"` or `"offline"` |
| `model` | Currently loaded model, or `null` if offline |
| `uptime_seconds` | Seconds since Flask server started |
| `requests_served` | Total inference requests handled |
| `total_tokens_generated` | Cumulative completion tokens generated |
| `cached_jobs` | Number of jobs with images available for retrieval |
| `max_tokens` | Default maximum tokens per request |
| `vllm_endpoint` | Internal vLLM server URL |
| `gpu` | GPU metrics object (see below) |
| `error` | Error message if vLLM is offline |

**GPU metrics fields:**

| Field | Description |
|-------|-------------|
| `gpu_name` | GPU model name |
| `gpu_utilization_percent` | GPU compute utilization (0-100) |
| `memory_used_mb` | VRAM currently in use (MB) |
| `memory_total_mb` | Total VRAM available (MB) |
| `memory_percent` | VRAM usage percentage |
| `temperature_c` | GPU temperature in Celsius |

## Web UI

A benchmark UI is available at the root URL:

```
https://vision.homeprem.no/
```

Features:
- Drag-and-drop image upload
- Model selector and custom prompts
- Three benchmark modes with real-time results
- Timeline visualization for simulate mode
- Statistics: throughput, batching benefit, max concurrent requests

## Notes

- **Continuous batching**: vLLM dynamically batches requests at the iteration level. Concurrent requests benefit from GPU parallelism without explicit queuing.
- **Warm-up**: First request after server start may be slower as the model initializes.
- **Image formats**: JPEG, PNG, and other common formats are supported.
- **Token limits**: Default `max_tokens` is 1024. Longer responses may be truncated.
- **GPU memory**: Model uses approximately 9.6GB VRAM (AWQ 4-bit quantization).

## Architecture

```
┌─────────────────┐     ┌─────────────┐     ┌────────────────┐
│  Client/UI      │────▶│ Flask API   │────▶│ vLLM Server    │
│  (browser/curl) │     │ (port 8081) │     │ (port 8000)    │
│                 │◀────│ /categorize │◀────│ GPU inference  │
│                 │     │ /benchmark  │     │ continuous     │
└─────────────────┘     └─────────────┘     │ batching       │
                                            └────────────────┘
```

## Systemd Services

Both services are enabled and will start automatically on boot:

- `vllm-server.service` - vLLM engine on port 8000
- `vlm-server.service` - Flask API/UI on port 8081

```bash
# Check status
sudo systemctl status vllm-server vlm-server

# Restart services
sudo systemctl restart vllm-server vlm-server

# View logs
journalctl -u vlm-server -f
journalctl -u vllm-server -f
```
