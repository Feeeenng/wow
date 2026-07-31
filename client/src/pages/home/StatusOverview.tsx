import {
  ChartNoAxesColumnIncreasing,
  Cpu,
  FileText,
  HardDrive,
  MemoryStick,
  Video,
} from "lucide-react";

const statuses = [
  { label: "录制状态", value: "待机中", detail: "未开始录制", icon: Video, tone: "orange" },
  { label: "日志监控", value: "正常", detail: "日志实时监控中", icon: FileText, tone: "green" },
  { label: "硬盘空间", value: "1.25 TB", detail: "可用空间充足", icon: HardDrive, tone: "blue" },
  { label: "内存使用", value: "32%", detail: "5.1 GB / 16 GB", icon: MemoryStick, tone: "green" },
  { label: "CPU 使用", value: "18%", detail: "Intel i7-12700K", icon: Cpu, tone: "orange" },
  { label: "版本信息", value: "v0.1.0", detail: "当前为 UI 原型", icon: ChartNoAxesColumnIncreasing, tone: "violet" },
];

/** 展示录制客户端关键运行状态摘要。 */
export function StatusOverview() {
  return (
    <section className="status-overview" aria-labelledby="status-title">
      <h2 id="status-title">状态总览</h2>
      <div className="status-grid">
        {statuses.map(({ label, value, detail, icon: Icon, tone }) => (
          <article key={label}>
            <div className={`status-icon ${tone}`}><Icon size={22} /></div>
            <div>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{detail}</small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
