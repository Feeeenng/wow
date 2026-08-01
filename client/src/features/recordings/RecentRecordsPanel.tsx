import { ChevronRight } from "lucide-react";
import "@/features/recordings/RecentRecordsPanel.css";

const records = [
  { name: "尼鲁巴尔宫殿（史诗）", date: "2024-05-20 21:32", detail: "08:45   256.7 MB", image: "/assets/record-1.png", version: "12.0", tone: "orange" },
  { name: "黑暗神殿（史诗）", date: "2024-05-20 20:15", detail: "12:04   358.9 MB", image: "/assets/record-2.png", version: "12.0", tone: "orange" },
  { name: "达萨罗之战（史诗）", date: "2024-05-19 23:05", detail: "06:18   189.4 MB", image: "/assets/record-3.png", version: "12.0", tone: "orange" },
  { name: "冰封王座（英雄）", date: "2024-05-19 20:50", detail: "09:12   221.6 MB", image: "/assets/record-4.png", version: "12.1", tone: "blue" },
];

/** 展示与参考图一致的最近录像列表。 */
export function RecentRecordsPanel() {
  return (
    <section className="ornate-panel recent-panel" aria-labelledby="recent-title">
      <div className="recent-heading"><h2 id="recent-title">最近记录</h2><button type="button" disabled>全部记录 <ChevronRight size={14} /></button></div>
      <div className="record-list">
        {records.map((record) => (
          <article className="record-item" key={record.name}>
            <img src={record.image} alt="" />
            <div><strong>{record.name}</strong><span>{record.date}</span><small>{record.detail}</small></div>
            <em className={record.tone}>{record.version}</em>
          </article>
        ))}
      </div>
      <button type="button" className="all-records" disabled>查看全部记录 <ChevronRight size={16} /></button>
    </section>
  );
}
