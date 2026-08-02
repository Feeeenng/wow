import {
  QuestionCircleOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Button, Empty, Tag, Tooltip } from "antd";
import type { ObsStatus } from "@/features/obs/model";

interface PersonalViewPanelProps {
  status: ObsStatus;
}

/** 在直播画面下方展示视角选择与当前身份，团队能力仅保留禁用状态。 */
export function PersonalViewPanel({ status }: PersonalViewPanelProps) {
  return (
    <aside className="grid grid-cols-[260px_360px_minmax(0,1fr)] gap-4 max-[1180px]:grid-cols-1">
      <section className="rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="m-0 text-base font-semibold">直播视角</h2>
          <Tooltip title="选择直播画面视角">
            <QuestionCircleOutlined className="text-[var(--app-text-secondary)]" />
          </Tooltip>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="primary" ghost icon={<UserOutlined />}>个人视角</Button>
          <Button disabled icon={<TeamOutlined />}>团队视角</Button>
        </div>
      </section>

      <section className="rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] p-4 shadow-sm">
        <h2 className="mb-4 mt-0 text-base font-semibold">当前个人视角</h2>
        <div className="flex items-center gap-3">
          <img className="h-11 w-11 rounded-full" src="/assets/user-avatar.png" alt="" />
          <div className="min-w-0 flex-1">
            <strong className="block truncate text-sm">木土猎人</strong>
            <span className={status.captureReady ? "text-xs text-emerald-600" : "text-xs text-gray-400"}>
              ● {status.captureReady ? "画面就绪" : "等待魔兽世界"}
            </span>
          </div>
          <Tag color="green" className="m-0">猎人</Tag>
        </div>
      </section>

      <section className="rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] p-4 shadow-sm">
        <h2 className="mb-4 mt-0 text-base font-semibold text-[var(--app-text-secondary)]">团队成员</h2>
        <div className="flex min-h-12 items-center justify-center">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="个人视角模式" />
        </div>
      </section>
    </aside>
  );
}
