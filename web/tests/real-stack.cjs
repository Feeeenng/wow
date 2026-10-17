const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

/** 复用隔离真实服务控制器；凭证只保存在父子进程内存，禁止打印ready消息。 */
class TestCloudStack {
  constructor({ python, privateFile, output, fixture, withWcl = true }) {
    this.python = python; this.privateFile = privateFile; this.output = output; this.fixture = fixture;
    this.pending = new Map(); this.buffered = new Map();
    this.withWcl = withWcl;
  }
  wait(name, timeout = 60000) {
    if (this.buffered.has(name)) { const value = this.buffered.get(name); this.buffered.delete(name); return Promise.resolve(value); }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(name); reject(new Error("隔离服务控制超时：" + name)); }, timeout);
      this.pending.set(name, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject });
    });
  }
  async start() {
    fs.mkdirSync(this.output, { recursive: true });
    this.child = spawn(this.python, [path.resolve(__dirname, "../../client/tests/real-cloud-stack.py"), "--private", this.privateFile, "--output", this.output, ...(this.withWcl ? ["--with-wcl"] : [])],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    let buffer = "";
    this.child.stdout.on("data", (bytes) => {
      buffer += bytes.toString("utf8");
      while (buffer.includes("\n")) {
        const end = buffer.indexOf("\n"), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let value; try { value = JSON.parse(line); } catch { continue; }
        const waiter = this.pending.get(value.event);
        if (waiter) { this.pending.delete(value.event); waiter.resolve(value); } else this.buffered.set(value.event, value);
      }
    });
    this.child.stderr.on("data", (bytes) => fs.appendFileSync(path.join(this.output, "bootstrap.log"), bytes));
    this.child.once("exit", () => { for (const waiter of this.pending.values()) waiter.reject(new Error("隔离服务已退出")); this.pending.clear(); });
    this.info = await this.wait("ready"); assert.match(this.info.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
    return this.info;
  }
  command(action) {
    const event = { inspect: "inspection", revoke: "revoked", downgrade: "downgraded", secondTeam: "secondTeamCreated", observerAnalyst: "observerUpdated", observerMember: "observerUpdated",
      preferencesUnavailable: "preferencesStorageUpdated", preferencesRestore: "preferencesStorageUpdated",
      wclRevision: "wclFixtureUpdated", wclFail: "wclFixtureUpdated", webWclHold: "wclFixtureUpdated", webWclResume: "wclFixtureUpdated", webBulkEvents: "wclFixtureUpdated", calibrationVersion: "calibrationVersionChanged",
      webBreakMedia: "webMediaUpdated", webRestoreMedia: "webMediaUpdated" }[action] ?? "cleanup";
    const response = this.wait(event); this.child.stdin.write(JSON.stringify({ action }) + "\n"); return response;
  }
  async request(route, method = "GET", data, token = this.info.token) {
    const response = await fetch(this.info.endpoint + "/api/v1" + route, { method,
      headers: { Authorization: "Bearer " + token, ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
      body: data === undefined ? undefined : JSON.stringify(data) });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      const locations = Array.isArray(error?.detail) ? error.detail.map((item) => item.loc.join(".")).join(", ") : "";
      throw new Error("隔离API请求失败，状态 " + response.status + " " + locations);
    }
    return response.json();
  }
  async seed({ importWcl = true, deviceId = "web-validation" } = {}) {
    const fixture = JSON.parse(fs.readFileSync(path.join(this.fixture, "fixture.json"), "utf8"));
    assert.equal(fixture.pullId, "0000000000000000000000000000000000000000000000000000000000000001");
    const bytes = fs.readFileSync(path.normalize(fixture.videoPath)), sha = crypto.createHash("sha256").update(bytes).digest("hex");
    const players = [{ guid: "Player-NativeReal0", name: "网页视角甲", fullType: "Hunter-Marksmanship" },
      { guid: "Player-Web1", name: "网页视角乙", fullType: "Mage-Frost" },
      { guid: "Player-WebGap", name: "缺片视角", fullType: "Rogue-Outlaw" },
      { guid: "Player-WebMissing", name: "尚未上传成员", fullType: "Priest-Holy" }];
    this.tasks = [];
    for (const index of [0, 1, 2]) {
      const start = index === 0 ? 12300 : index === 1 ? 11800 : 12000;
      const task = await this.request("/recordings", "POST", { teamId: this.info.teamId, teamPullId: this.info.teamPullId,
        deviceId, localPullId: "web-pov-" + index, artifactVersion: sha, fileSizeBytes: bytes.length, fileSha256: sha,
        characterGuid: players[index].guid, characterName: players[index].name, encounterId: 7001, encounterName: "真实网页合成首领",
        difficultyId: 16, encounterStartUnixMs: start, encounterEndUnixMs: start + 10000, videoZeroMs: index === 1 ? 4000 : 2000,
        videoDurationMs: fixture.mapping.mediaDurationMs, groupSize: 4, players,
        hasGap: index === 2, mediaCalibrated: index === 2, intervals: index === 2 ? [
          { pullStartMs: 0, pullEndMs: 4000, videoStartMs: 2000, videoEndMs: 6000 },
          { pullStartMs: 6000, pullEndMs: 10000, videoStartMs: 6000, videoEndMs: 10000 },
        ] : [] });
      for (let number = 1; number <= task.totalParts; number++) {
        const part = bytes.subarray((number - 1) * task.partSizeBytes, number * task.partSizeBytes);
        const signed = await this.request("/uploads/" + task.uploadId + "/parts", "POST",
          { partNumber: number, checksumSha256: crypto.createHash("sha256").update(part).digest("hex") });
        const put = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: part });
        assert.equal(put.status, 200); await this.request("/uploads/" + task.uploadId + "/parts/" + number + "/confirm", "POST");
      }
      await this.request("/uploads/" + task.uploadId + "/complete", "POST"); this.tasks.push(task);
    }
    const deadline = Date.now() + 120000;
    while (true) {
      const statuses = await Promise.all(this.tasks.map((task) => this.request("/uploads/" + task.uploadId + "/status")));
      if (statuses.every((value) => value.recordingStatus === "ready" && value.fullFileSha256Verified)) break;
      assert.ok(!statuses.some((value) => value.recordingStatus === "failed"), "合成媒体处理失败");
      assert.ok(Date.now() < deadline, "后台媒体处理超时"); await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (importWcl) {
      await this.request("/teams/" + this.info.teamId + "/pulls/" + this.info.teamPullId + "/wcl/imports", "POST",
        { reportCode: this.info.wclReportCode, fightId: 1, actorBindings: this.tasks.slice(0, 2).map((task, index) => ({ recordingId: task.recordingId, actorId: index + 1 })) });
      while (true) {
        const value = await this.request("/teams/" + this.info.teamId + "/pulls/" + this.info.teamPullId + "/wcl");
        if (value.status === "ready") break;
        assert.notEqual(value.status, "failed"); assert.ok(Date.now() < deadline); await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    this.records = await this.request("/teams/" + this.info.teamId + "/recordings?limit=100");
    return { players, records: this.records, sourceSha256: sha };
  }
  async close() {
    if (!this.child || this.child.exitCode !== null) return { cleaned: true, alreadyExited: true };
    const cleanup = await this.command("cleanup"); this.child.stdin.end();
    assert.equal(cleanup.cleaned, true); return cleanup;
  }
}
module.exports = { TestCloudStack };
