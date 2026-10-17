"""仅启动实际 API 进程检查入口；不将存活探测当成数据库或存储联调。"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


def test_uvicorn_starts_with_explicit_config_and_exports_contract_without_credentials(tmp_path):
    """使用不可达虚构服务配置，只验证真实 HTTP 启动和 OpenAPI，不产生数据库写入。"""
    log = tmp_path / "api.log"
    environment = {**os.environ, "WOW_PUBLIC_API_URL": "http://127.0.0.1:18000"}
    with log.open("wb") as output:
        process = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "0", "--no-access-log"],
                                   cwd=Path(__file__).resolve().parents[2], env=environment, stdout=output, stderr=output)
    try:
        deadline = time.monotonic() + 15
        address = None
        while time.monotonic() < deadline:
            text = log.read_text(encoding="utf-8", errors="replace")
            found = re.search(r"http://127\.0\.0\.1:(\d+)", text)
            if found:
                address = "http://127.0.0.1:" + found[1]
                break
            if process.poll() is not None:
                raise AssertionError("API 进程未正常启动")
            time.sleep(0.1)
        assert address is not None
        with urllib.request.urlopen(address + "/health/live", timeout=5) as response:
            assert json.load(response) == {"status": "alive"}
        with urllib.request.urlopen(address + "/openapi.json", timeout=5) as response:
            raw = response.read().decode()
        contract = json.loads(raw)
        assert "/api/v1/recordings" in contract["paths"]
        assert "/api/v1/teams/{team_id}/recordings/{recording_id}/media/{filename}" in contract["paths"]
        assert "test-secret-only" not in raw
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
