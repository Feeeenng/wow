import { ChevronRight, Flame, Snowflake, Sparkles, Swords } from "lucide-react";

const records = [
  { name: "尼鲁巴尔宫殿（史诗）", date: "2026-07-31 21:32", detail: "08:45  ·  256.7 MB", icon: Flame, tone: "orange" },
  { name: "黑暗神殿（史诗）", date: "2026-07-31 20:15", detail: "12:04  ·  358.9 MB", icon: Swords, tone: "gold" },
  { name: "达萨罗之战（史诗）", date: "2026-07-30 23:05", detail: "06:18  ·  189.4 MB", icon: Sparkles, tone: "violet" },
  { name: "冰封王座（英雄）", date: "2026-07-30 19:50", detail: "09:12  ·  221.6 MB", icon: Snowflake, tone: "blue" },
];

/** 展示首页最近记录列表，当前仅作为静态视觉内容。 */
export function RecentRecords() {
  return (
    <section className="dashboard-panel recent-panel" aria-labelledby="recent-title">
      <div className="recent-heading">
        <h2 id="recent-title">最近记录</h2>
        <button type="button" disabled>全部记录 <ChevronRight size={14} /></button>
      </div>
      <div className="record-list">
        {records.map(({ name, date, detail, icon: Icon, tone }) => (
          <article className="record-item" key={name}>
            <div className={`record-icon ${tone}`}><Icon size={24} /></div>
            <div>
              <strong>{name}</strong>
              <span>{date}</span>
              <small>{detail}</small>
            </div>
            <em>12.0</em>
          </article>
        ))}
      </div>
      <button type="button" className="all-records" disabled>
        查看全部记录 <ChevronRight size={16} />
      </button>
    </section>
  );
}
