"""Real local sockets verify that closing the progress stream stops outstanding work."""

import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx


def test_stream_disconnect_cancels_inflight_and_queued_reviews(tmp_path):
    backend = Path(__file__).resolve().parents[1]
    log = tmp_path / "calls.jsonl"
    script = tmp_path / "socket_server.py"
    with socket.socket() as socket_handle:
        socket_handle.bind(("127.0.0.1", 0))
        port = socket_handle.getsockname()[1]
    script.write_text(f"""
import asyncio,json
from pathlib import Path
import main,jev,uvicorn
raw=json.loads(Path({str(backend / "tests/fixtures/legacy.json")!r}).read_text())["cases"][0]["raw"]
def record(event,id):
    with open({str(log)!r},"a") as output: output.write(json.dumps({{"event":event,"id":id}})+"\\n")
async def fake(review,*,request_id,**kwargs):
    record("start",review.review_id)
    if review.review_id=="0": return jev.normalize_result(raw,review,request_id,120)
    try: await asyncio.sleep(30)
    except asyncio.CancelledError:
        record("cancelled",review.review_id)
        raise
main.analyze_with_jev=fake
uvicorn.run(main.app,host="127.0.0.1",port={port},log_level="warning")
""")
    env = {
        **os.environ,
        "PYTHONPATH": str(backend),
        "TYPESAFE_API_KEY": "test-only-key",
    }
    process = subprocess.Popen(
        [sys.executable, str(script)],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                if (
                    httpx.get(
                        f"http://127.0.0.1:{port}/api/health", timeout=0.2
                    ).status_code
                    == 200
                ):
                    break
            except httpx.TransportError:
                pass
            time.sleep(0.02)
        else:
            raise AssertionError("Socket test server did not start")
        reviews = [
            {"reviewId": str(i), "product": "Phone", "reviewText": "Good"}
            for i in range(50)
        ]
        with httpx.stream(
            "POST",
            f"http://127.0.0.1:{port}/api/batch",
            json={"reviews": reviews},
            timeout=2,
        ) as response:
            assert response.status_code == 200
            for line in response.iter_lines():
                if json.loads(line)["type"] == "progress":
                    break
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            events = [json.loads(line) for line in log.read_text().splitlines()]
            if any(item["event"] == "cancelled" for item in events):
                break
            time.sleep(0.02)
        else:
            raise AssertionError("Client disconnect did not cancel the batch")
        started = [item["id"] for item in events if item["event"] == "start"]
        assert len(started) <= 3  # One completed request plus at most two in flight.
        time.sleep(0.05)
        assert len(
            [item for item in log.read_text().splitlines() if '"start"' in item]
        ) == len(started)
    finally:
        process.terminate()
        process.wait(timeout=5)
