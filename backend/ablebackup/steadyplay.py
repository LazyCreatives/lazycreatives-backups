"""Playing a song straight off a NAS without it stopping at a network blip.

Over Wi-Fi or Tailscale a read from the NAS can fail for a moment ("Invalid
argument" on Windows) while the link recovers. A plain file response gives up
mid-song; this one opens the file again where it was and carries on, a few times,
before giving up. Seeking works as before (the player asks for parts of the file).
The file is only read.
"""
from __future__ import annotations

import mimetypes
import os
import time

from starlette.responses import Response, StreamingResponse

from ablebackup.playback import _RANGE

CHUNK = 256 * 1024
TRIES = 5


def _chunks(path: str, start: int, end: int, pause: float):
    pos, tries, f = start, 0, None
    try:
        while pos <= end:
            try:
                if f is None:
                    f = open(path, "rb")
                    f.seek(pos)
                data = f.read(min(CHUNK, end - pos + 1))
            except OSError:
                tries += 1
                if tries > TRIES:
                    raise
                if f is not None:
                    f.close()
                    f = None
                time.sleep(pause * tries)
                continue
            if not data:
                break
            tries = 0
            pos += len(data)
            yield data
    finally:
        if f is not None:
            f.close()


def response(path: str, range_header: str | None, media_type: str | None = None,
             pause: float = 0.5) -> Response:
    size = os.path.getsize(path)
    kind = media_type or mimetypes.guess_type(path)[0] or "application/octet-stream"
    head = {"Accept-Ranges": "bytes"}
    m = _RANGE.match((range_header or "").strip())
    if not m or (not m.group(1) and not m.group(2)):
        return StreamingResponse(_chunks(path, 0, size - 1, pause), media_type=kind,
                                 headers={**head, "Content-Length": str(size)})
    if m.group(1):
        start = int(m.group(1))
        end = min(int(m.group(2)) if m.group(2) else size - 1, size - 1)
    else:  # the last N bytes
        start, end = max(0, size - int(m.group(2))), size - 1
    if start >= size or start > end:
        return Response(status_code=416, headers={**head, "Content-Range": f"bytes */{size}"})
    return StreamingResponse(_chunks(path, start, end, pause), status_code=206, media_type=kind,
                             headers={**head, "Content-Length": str(end - start + 1),
                                      "Content-Range": f"bytes {start}-{end}/{size}"})
