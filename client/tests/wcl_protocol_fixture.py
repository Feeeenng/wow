"""受控 WCL HTTP 协议服务，仅用于真实后端导入验收，禁止访问线上 WCL。"""

import copy
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class WclProtocolFixture:
    """固定公开报告包含空页、同名玩家、负公共时间及环境来源。"""

    code = "AbCdEfGh12345678"
    client_id = "native-offline-client"
    client_secret = "native-offline-secret"
    access_token = "native-offline-http-token"

    def __init__(self):
        """在随机回环端口启动，不允许报告代码改变请求目标。"""
        self.lock = threading.Lock()
        self.release = threading.Event()
        self.release.set()
        self.state = {"revision": 1, "mode": "ok", "requests": 0, "pages": []}
        report = {"code": self.code, "visibility": "public", "startTime": 11500, "endTime": 21500,
            "fights": [{"id": 1, "encounterID": 7001, "difficulty": 16, "startTime": 0, "endTime": 10000,
                "inProgress": False, "friendlyPlayers": [1, 2], "enemyNPCs": [{"id": 10}]}],
            "masterData": {"actors": [{"id": 1, "type": "Player", "name": "同名标准角色", "subType": "Hunter"},
                {"id": 2, "type": "Player", "name": "同名标准角色", "subType": "Hunter"},
                {"id": 10, "type": "NPC", "name": "标准敌方"}, {"id": 20, "type": None, "name": "未知类型对象"}],
                "abilities": [{"gameID": 642, "name": "标准圣盾术", "icon": "spell_holy_divineshield.jpg"},
                    {"gameID": 17, "name": "标准真言盾", "icon": "spell_holy_powerwordshield.jpg"},
                    {"gameID": 12345, "name": "标准敌方施法", "icon": "test.jpg"}]}}
        owner = self

        class Handler(BaseHTTPRequestHandler):
            """协议响应来自固定测试数据，认证只验证用途，不记录内容。"""

            def do_POST(self):
                """返回元数据或带严格推进游标的事件页。"""
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                with owner.lock:
                    owner.state["requests"] += 1
                    revision, mode = owner.state["revision"], owner.state["mode"]
                if self.path == "/oauth/token":
                    assert self.headers["Authorization"].startswith("Basic ")
                    assert body == b"grant_type=client_credentials"
                    payload = {"access_token": owner.access_token, "expires_in": 3600}
                else:
                    if mode == "hold":
                        owner.release.wait(timeout=20)
                    assert self.path == "/api/v2/client"
                    assert self.headers["Authorization"] == "Bearer " + owner.access_token
                    request = json.loads(body)
                    assert request["variables"]["code"] == owner.code
                    value = copy.deepcopy(report)
                    value["revision"] = revision
                    if "query Events" in request["query"]:
                        start = request["variables"]["start"]
                        with owner.lock:
                            owner.state["pages"].append(start)
                        if mode == "loop":
                            page = {"data": [], "nextPageTimestamp": start}
                        elif mode == "bulk":
                            events = [{"type": "cast", "timestamp": 500 + index * 8, "sourceID": index % 2 + 1,
                                "abilityGameID": 17 if index % 2 else 642} for index in range(1057)]
                            page = {"data": [] if start == 0 else events, "nextPageTimestamp": 100 if start == 0 else None}
                        elif start == 0:
                            page = {"data": [], "nextPageTimestamp": 100}
                        elif start == 100:
                            page = {"data": [{"type": "cast", "timestamp": 100, "sourceID": 1, "abilityGameID": 17},
                                {"type": "cast", "timestamp": 5000, "sourceID": 10, "abilityGameID": 12345},
                                {"type": "cast", "timestamp": 6500, "sourceID": 1, "abilityGameID": 642},
                                {"type": "cast", "timestamp": 7000, "sourceID": 2, "abilityGameID": 17}], "nextPageTimestamp": 7500}
                        else:
                            page = {"data": [{"type": "applybuff", "timestamp": 7500, "sourceID": 2, "targetID": 1, "abilityGameID": 17},
                                {"type": "death", "timestamp": 8500, "sourceID": -1, "targetID": 1},
                                {"type": "death", "timestamp": 9000, "sourceID": 0, "targetID": 2}], "nextPageTimestamp": None}
                        value = {"revision": revision, "events": page}
                    payload = {"data": {"reportData": {"report": value}}}
                encoded = json.dumps(payload).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def log_message(self, *_):
                """禁止标准库打印认证或业务请求。"""
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"

    def snapshot(self):
        """只导出非敏感验证计数，不返回任何凭证。"""
        with self.lock:
            return copy.deepcopy(self.state)

    def set_mode(self, mode):
        """模拟分页故障或下一份报告版本，不直接改后端状态。"""
        with self.lock:
            self.state["mode"] = mode if mode in {"loop", "bulk", "hold"} else "ok"
            if mode == "hold":
                self.release.clear()
            else:
                self.release.set()
            if mode in {"revision", "bulk"}:
                self.state["revision"] += 1

    def close(self):
        """仅关闭本夹具 HTTP 服务。"""
        self.release.set()
        self.server.shutdown()
        self.thread.join(timeout=3)
        self.server.server_close()
