import {
  CloudUploadOutlined,
  FileSearchOutlined,
  PlayCircleOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Button, Empty, Progress, Tag } from "antd";

interface HomePageProps {
  onOpenSettings: () => void;
}

const steps = [
  { title: "配置采集", detail: "安装 OBS 并设置游戏画面", icon: SettingOutlined },
  { title: "监控日志", detail: "选择战斗日志目录", icon: FileSearchOutlined },
  { title: "开始记录", detail: "进入副本后自动关联录制", icon: PlayCircleOutlined },
  { title: "上传复盘", detail: "Pull 结束后提交素材", icon: CloudUploadOutlined },
];

/** 展示客户端概览，配置入口统一跳转到设置页。 */
export function HomePage({ onOpenSettings }: HomePageProps) {
  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <section className="border border-[var(--app-border)] bg-[var(--app-surface)] p-5">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="m-0 text-base font-semibold">快速开始</h2>
            <p className="mb-0 mt-1 text-sm text-[var(--app-text-secondary)]">完成采集和日志配置后即可记录团队战斗。</p>
          </div>
          <Button type="primary" icon={<SettingOutlined />} onClick={onOpenSettings}>打开设置</Button>
        </div>
        <div className="grid grid-cols-4 divide-x divide-[var(--app-border)] border border-[var(--app-border)]">
          {steps.map(({ title, detail, icon: Icon }, index) => (
            <div className="flex min-w-0 gap-3 p-4" key={title}>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-blue-50 text-[var(--app-primary)]">
                <Icon />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">{index + 1}. {title}</div>
                <p className="mb-0 mt-1 text-xs text-[var(--app-text-secondary)]">{detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-5">
        <section className="border border-[var(--app-border)] bg-[var(--app-surface)] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="m-0 text-base font-semibold">当前活动</h2>
            <Tag>等待进入副本</Tag>
          </div>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有进行中的团队活动" />
        </section>
        <section className="border border-[var(--app-border)] bg-[var(--app-surface)] p-5">
          <h2 className="m-0 text-base font-semibold">本地存储</h2>
          <div className="mt-5 flex items-end justify-between">
            <strong className="text-2xl">24.8 GB</strong>
            <span className="text-xs text-[var(--app-text-secondary)]">可用 1.25 TB</span>
          </div>
          <Progress className="mt-3" percent={18} showInfo={false} />
          <p className="mb-0 mt-4 text-xs text-[var(--app-text-secondary)]">录制文件在上传完成前保留在本地。</p>
        </section>
      </div>
    </div>
  );
}
