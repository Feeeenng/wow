import { useEffect, useRef, useState } from "react";
import { Alert, Button, Drawer, Input, InputNumber, Select, Spin, Tag, Typography } from "antd";
import { FileSearchOutlined } from "@ant-design/icons";
import type { LocalRecording } from "@/shared/replay/model";
import { parseWclReference } from "@/shared/replay/reports";
import { WCL_FIGHT_ID_MAX, WCL_REPORT_REFERENCE_MAX_CHARS } from "@/shared/replay/config";
import { useWclReport } from "@/replay/reports/useWclReport";
import "@/replay/reports/reports.css";

const labels = { unbound: "尚未关联报告", pending: "等待导入", importing: "正在导入", ready: "标准事件已就绪", failed: "导入失败" };

/** 只提交报告代码、fight及显式人物绑定，WCL应用凭证由部署者配置。 */
export function WclReportPanel({ team, pull, views, onPublished }: {
  team: string; pull: string | null; views: LocalRecording[]; onPublished: () => void;
}) {
  const [open, setOpen] = useState(false);
  const report = useWclReport(open, team, pull, onPublished), status = report.status;
  const [reference, setReference] = useState("");
  const [fight, setFight] = useState<number | null>(null), [bindings, setBindings] = useState<Record<string, number>>({});
  const initialized = useRef(false);
  useEffect(() => {
    if (!open || !status || initialized.current) return;
    initialized.current = true; setReference(status.reportCode ?? ""); setFight(status.fightId ?? null);
    setBindings(Object.fromEntries(status.actorBindings.map((item) => [item.recordingId, item.actorId])));
  }, [open, status]);
  const parsed = parseWclReference(reference);
  const busy = report.submitting || status?.status === "pending" || status?.status === "importing";
  const locked = busy || report.loading || !status?.canImport;
  const sameReport = parsed?.reportCode === status?.publishedReportCode && fight === status?.publishedFightId;
  const actors = sameReport ? status?.actors.filter((actor) => actor.type === "Player") ?? [] : [];
  const validFight = Number.isSafeInteger(fight) && (fight ?? 0) > 0 && (fight ?? 0) <= WCL_FIGHT_ID_MAX;
  const buttonLabel = status?.revision ? "重新导入并应用人物绑定" : status?.status === "failed" ? "重试导入标准事件" : "导入标准事件";
  return <>
    <Button aria-label="标准事件" icon={<FileSearchOutlined />} disabled={!pull} onClick={() => setOpen(true)}>标准事件</Button>
    <Drawer title="关联标准战斗事件" open={open} onClose={() => setOpen(false)} size={520} getContainer={false}>
      <div className="wcl-report-panel">
        <p className="muted">完整日志由 Archon 上传。这里关联公开 WCL 报告，不重复上传本地 CombatLog；私有及未列出报告暂不支持。</p>
        {report.loading && <div role="status"><Spin size="small" /> 正在读取导入状态</div>}
        {report.error && <Alert type="error" showIcon message="标准事件请求失败" description={report.error}
          action={<Button size="small" onClick={report.refresh}>重试读取</Button>} />}
        {status && <div className="wcl-status"><Tag>{labels[status.status]}</Tag><span>已发布 {status.eventCount} 个关键事件</span></div>}
        {status && !status.configured && <Alert type="info" showIcon message="服务器尚未配置 WCL 应用凭证"
          description="请部署者在服务端配置应用凭证，不要将 client secret 填入网页。录像仍可播放。" />}
        {status && !status.canImport && <Alert type="info" showIcon message="当前账号仅可查看，导入需要团长或分析员权限。" />}
        {status?.error && <Alert type="warning" showIcon message="本次报告导入未完成" description={status.error} />}
        {status?.revision && <p className="muted">当前已发布事件来自报告 {status.publishedReportCode}，战斗 {status.publishedFightId}。</p>}
        <div className="wcl-field"><label htmlFor="web-wcl-reference">WCL 报告链接或代码</label>
          <Input id="web-wcl-reference" value={reference} maxLength={WCL_REPORT_REFERENCE_MAX_CHARS} disabled={locked}
            placeholder="https://cn.warcraftlogs.com/reports/…#fight=…" onChange={(event) => {
              const value = event.target.value, next = parseWclReference(value);
              setReference(value); setFight(next?.fightId ?? null);
            }} />
        </div>
        {!!reference && !parsed && <Typography.Text type="danger">请输入 16 位报告代码或官方 HTTPS 报告链接。</Typography.Text>}
        <div className="wcl-field"><label htmlFor="web-wcl-fight">战斗编号 fight</label>
          <InputNumber id="web-wcl-fight" aria-label="战斗编号 fight" value={fight} precision={0} min={1} max={WCL_FIGHT_ID_MAX} disabled={locked} onChange={setFight} />
        </div>
        {actors.length > 0 && <div className="wcl-actors">
          <strong>录像与 WCL 人物</strong>
          <p className="muted">明确选择每路视角的本人角色；未绑定时显示团队事件，不按同名人物猜测。</p>
          {views.map((view) => <label key={view.pullId} className="wcl-field" htmlFor={"web-wcl-actor-" + view.pullId}>{view.playerName ?? "人物未识别"}
            <Select id={"web-wcl-actor-" + view.pullId} aria-label={"WCL人物绑定" + (view.playerName ?? view.pullId)}
              allowClear placeholder="不绑定本人" value={bindings[view.pullId]} disabled={locked}
              options={actors.map((actor) => ({ value: actor.actorId, label: actor.name + " · " + (actor.subType ?? "玩家") + " · #" + actor.actorId }))}
              onChange={(actor: number | undefined) => setBindings((old) => {
                const next = { ...old }; if (actor === undefined) delete next[view.pullId]; else next[view.pullId] = actor; return next;
              })} />
          </label>)}
        </div>}
        <Button type="primary" aria-label={buttonLabel} loading={report.submitting} disabled={locked || !status?.configured || !parsed || !validFight}
          onClick={() => {
            if (!parsed || !fight) return;
            void report.start({ reportCode: parsed.reportCode, fightId: fight, refresh: Boolean(status?.revision),
              actorBindings: sameReport ? views.flatMap((view) => bindings[view.pullId] ? [{ recordingId: view.pullId, actorId: bindings[view.pullId] }] : []) : [] });
          }}>{buttonLabel}</Button>
        <p className="muted">关闭面板后后台导入继续运行；重新打开可读取进度。重新导入期间保留旧事件，完整成功后才切换版本，不影响观看录像。</p>
      </div>
    </Drawer>
  </>;
}
