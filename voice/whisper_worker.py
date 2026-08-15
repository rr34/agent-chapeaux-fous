#!/usr/bin/env python3
"""Persistent local faster-whisper worker using JSON lines on stdin/stdout."""

import json
import os
import sys
import traceback

from faster_whisper import WhisperModel


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def main():
    model_name = os.environ.get("SLAYER_WHISPER_MODEL", "base.en")
    device = os.environ.get("SLAYER_WHISPER_DEVICE", "cpu")
    compute_type = os.environ.get("SLAYER_WHISPER_COMPUTE_TYPE", "int8")
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    emit({"type": "ready", "model": model_name, "device": device, "computeType": compute_type})

    for line in sys.stdin:
        try:
            request = json.loads(line)
            request_id = request["id"]
            segments, info = model.transcribe(
                request["inputPath"],
                beam_size=5,
                vad_filter=True,
                condition_on_previous_text=True,
            )
            collected = list(segments)
            text = " ".join(segment.text.strip() for segment in collected if segment.text.strip()).strip()
            duration_ms = round(max((segment.end for segment in collected), default=0) * 1000)
            emit({
                "id": request_id,
                "ok": True,
                "text": text,
                "language": info.language,
                "languageProbability": info.language_probability,
                "durationMs": duration_ms,
                "model": model_name,
            })
        except Exception as error:  # The Node service records this failure in the ledger.
            emit({
                "id": locals().get("request_id"),
                "ok": False,
                "error": str(error),
                "errorType": type(error).__name__,
            })
            traceback.print_exc(file=sys.stderr)


if __name__ == "__main__":
    main()
