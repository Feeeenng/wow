import { useEffect, useRef, useState } from "react";
import { Alert, Button, Drawer, Input, InputNumber, Select, Spin, Tag, Typography } from "antd";
import type { LocalRecording } from "@/shared/replay/model";
import { useCloud } from "@/features/cloud/CloudProvider";
import { parseWclReference } from "@/shared/replay/reports";
import { useWclReport } from "@/features/replay/reports/useWclReport";
import { WCL_FIGHT_ID_MAX, WCL_REPORT_REFERENCE_MAX_CHARS } from "@/shared/replay/config";

interface Props {
  recording: LocalRecording | null;
  recordings: LocalRecording[];
  onPublished: () => void;
}

const labels = { unbound: "尚未关联报告", pending: "等待导入", importing: "正在导入", ready: "标准事件已就绪", failed: "导入失败" };

/** 显式关联公开报告和人物；缺凭证、权限或未完成的导入不会阻塞已就绪录像。 */
export function WclReportButton({ recording, recordings, onPublished }: Props) {
  const [open, setOpen] = useState(false);
  const cloud = useCloud();
  const pullId = recording?.cloudTeamPullId;
  const connection = cloud.settings?.connectionKey ?? "";
  const report = useWclReport(open, pullId, connection, onPublished);
  const [reference, setReference] = useState("");
  const [fightId, setFightId] = useState<number | null>(null);
  const [bindings, setBindings] = useState<Record<string, number>>({});
  const initialized = useRef<string | null>(null);
  const key = `${connection}:${pullId ?? ""}`;
  const status = report.status;
  useEffect(() => {
    if (!open || !status || initialized.current === key) return;
    initialized.current = key;
    setReference(status.reportCode ?? "");
    setFightId(status.fightId ?? null);
    setBindings(Object.fromEntries(status.actorBindings.map((binding) => [binding.recordingId, binding.actorId])));
  }, [open, status, key]);
  const parsed = parseWclReference(reference);
  const validFight = Number.isSafeInteger(fightId) && (fightId ?? 0) > 0 && (fightId ?? 0) <= WCL_FIGHT_ID_MAX;
  const busy = report.submitting || status?.status === "pending" || status?.status === "importing";
  const sameReport = parsed?.reportCode === (status?.publishedReportCode ?? status?.reportCode)
    && fightId === (status?.publishedFightId ?? status?.fightId);
  const views = recordings.filter((item) => item.sourceKind === "cloud" && item.cloudTeamPullId === pullId);
  const actors = status?.actors.filter((actor) => actor.type === "Player") ?? [];

  return <>
    <Button size="small" disabled={!pullId} onClick={() => setOpen(true)}>标准事件</Button>
    <Drawer title="关联标准战斗事件" open={open} onClose={() => setOpen(false)} width={520}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--app-text-secondary)]">完整日志由 Archon 上传。这里关联公开 WCL 报告和战斗编号，不重复上传本地 CombatLog。私有及未列出报告暂不支持。</p>
        {report.loading && <div role="status"><Spin size="small" /> 正在读取导入状态</div>}
        {report.error && <Alert type="error" showIcon message="标准事件请求失败" description={report.error} action={<Button size="small" onClick={report.refresh}>重试读取</Button>} />}
        {status && <div className="flex flex-wrap items-center gap-2"><Tag>{labels[status.status]}</Tag><span className="text-xs">已发布 {status.eventCount} 个关键事件</span></div>}
        {status && !status.configured && <Alert type="info" showIcon message="服务器尚未配置 WCL 应用凭证" description="请由部署者在服务端配置应用凭证；不要将 client secret 填入客户端。录像仍可播放。" />}
        {status && !status.canImport && <Alert type="info" showIcon message="当前账号仅可查看，导入需要团长或分析员权限。" />}
        {status?.error && <Alert type="warning" showIcon message="本次报告导入未完成" description={status.error} />}
        {status?.revision && status.publishedReportCode && <p className="text-xs text-[var(--app-text-secondary)]">当前已发布事件来自报告 {status.publishedReportCode}，战斗 {status.publishedFightId}。</p>}
        <div className="space-y-2">
          <label htmlFor="wcl-report-reference">WCL 报告链接或代码</label>
          <Input id="wcl-report-reference" value={reference} maxLength={WCL_REPORT_REFERENCE_MAX_CHARS} disabled={busy || !status?.canImport}
            placeholder="https://cn.warcraftlogs.com/reports/…#fight=…"
            onChange={(event) => {
              setReference(event.target.value);
              const next = parseWclReference(event.target.value);
              if (next?.fightId) setFightId(next.fightId);
            }} />
          {reference && !parsed && <Typography.Text type="danger">请输入 16 位报告代码或官方 HTTPS 报告链接。</Typography.Text>}
        </div>
        <div className="space-y-2">
          <label className="block" htmlFor="wcl-fight-id">战斗编号 fight</label>
          <InputNumber id="wcl-fight-id" min={1} max={WCL_FIGHT_ID_MAX} precision={0} value={fightId}
            disabled={busy || !status?.canImport} onChange={setFightId} />
        </div>
        {sameReport && actors.length > 0 && <div className="space-y-3">
          <strong className="text-sm">录像与 WCL 人物</strong>
          <p className="text-xs text-[var(--app-text-secondary)]">明确指定每路视角的本人角色；不绑定时仍展示团队事件，不按同名人物自动匹配。</p>
          {views.map((view) => <div key={view.pullId} className="space-y-1">
            <label className="block text-sm" htmlFor={`wcl-actor-${view.pullId}`}>{view.playerName ?? "人物未识别"}</label>
            <Select id={`wcl-actor-${view.pullId}`} aria-label={`WCL人物绑定${view.playerName ?? view.pullId}`} className="w-full" allowClear
              placeholder="不绑定本人" value={bindings[view.pullId]} disabled={busy || !status?.canImport}
              options={actors.map((actor) => ({ value: actor.actorId, label: `${actor.name} · ${actor.subType ?? "玩家"} · #${actor.actorId}` }))}
              onChange={(actorId: number | undefined) => setBindings((current) => {
                const next = { ...current }; if (actorId === undefined) delete next[view.pullId]; else next[view.pullId] = actorId; return next;
              })} />
          </div>)}
        </div>}
        <Button type="primary" loading={report.submitting} disabled={!status?.configured || !status.canImport || busy || !parsed || !validFight}
          onClick={() => {
            if (!parsed || !fightId) return;
            void report.start({ reportCode: parsed.reportCode, fightId, refresh: Boolean(status?.revision), actorBindings: sameReport
              ? views.flatMap((view) => bindings[view.pullId] ? [{ recordingId: view.pullId, actorId: bindings[view.pullId] }] : []) : [] });
          }}>{status?.revision ? "重新导入并应用人物绑定" : "导入标准事件"}</Button>
        {status?.revision && <p className="text-xs text-[var(--app-text-secondary)]">重新导入期间保留已发布事件；只有完整导入成功后才切换版本。</p>}
      </div>
    </Drawer>
  </>;
}
