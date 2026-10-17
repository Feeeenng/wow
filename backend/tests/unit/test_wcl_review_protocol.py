"""通过真实loopback HTTP核对导入及死亡窗口来自同一事实集与显式资源开关。"""

import importlib.util
from pathlib import Path
import time

from pydantic import SecretStr

from app.services.wcl.adapter import WclClient
from app.services.wcl.normalization import metadata, normalize, normalization_indexes


def test_window_resource_flag_preserves_default_import_query(settings):
    """默认导入无资源；窗口显式开启后才提供生命采样，不用伪造API响应补齐。"""
    path = Path(__file__).resolve().parents[3] / "client/tests/wcl_protocol_fixture.py"
    spec = importlib.util.spec_from_file_location("review_protocol_fixture", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    fixture = module.WclProtocolFixture(review=True)
    configured = settings.model_copy(update={"wcl_client_id": SecretStr(fixture.client_id), "wcl_client_secret": SecretStr(fixture.client_secret),
        "wcl_token_url": fixture.origin + "/oauth/token", "wcl_api_url": fixture.origin + "/api/v2/client"})
    client = WclClient(configured)
    try:
        report = client.report(fixture.code)
        fight, data = metadata(report, 1, {"actorBindings": []})
        indexes = normalization_indexes(data)
        all_events = [event for page in client.pages(fixture.code, fight, 1, time.monotonic() + 10) for event in page]
        assert len(all_events) == 267 and not any("targetResources" in event for event in all_events)
        assert fixture.snapshot()["resourceQueries"] == 0
        assert len([event for index, raw in enumerate(all_events) if (event := normalize(raw, fixture.code, report["startTime"], index, data, indexes)) is not None]) == 7
        window = {**fight, "startTime": 500, "endTime": 8501}
        detailed = [event for page in client.pages(fixture.code, window, 1, time.monotonic() + 10, include_resources=True) for event in page]
        assert len(detailed) == 265 and fixture.snapshot()["resourceQueries"] == 2
        assert next(event for event in detailed if "targetResources" in event)["targetResources"]["hitPoints"] == 80
        normalized = [{key: value for key, value in event.items() if key != "targetResources"} for event in detailed]
        assert normalized == [event for event in all_events if 500 <= event["timestamp"] <= 8501]
    finally:
        client.close()
        fixture.close()
