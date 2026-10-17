import { useState } from "react";
import { Button, ConfigProvider, Empty, Select, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { PlayCircleOutlined } from "@ant-design/icons";
import { SessionProvider, useSession } from "@/auth/SessionProvider";
import { LoginPage } from "@/auth/LoginPage";
import { ReplayWorkbench } from "@/replay/ReplayWorkbench";
import { readReplayLink } from "@/replay/navigation";
import { TimelineProvider } from "@/replay/timeline/layout/TimelineProvider";

function SignedIn() {
  const { profile, logout } = useSession();
  const [initial] = useState(() => readReplayLink(window.location.search));
  const [team, setTeam] = useState(() => initial.team && profile!.teams.some((item) => item.teamId === initial.team)
    ? initial.team : initial.team ? "" : profile!.teams[0]?.teamId ?? "");
  return <TimelineProvider><div className="app-shell"><header className="app-header">
    <PlayCircleOutlined className="brand-icon" /><strong>团队战斗复盘</strong>
    <Select aria-label="选择团队" placeholder="选择已授权团队" value={team || undefined} onChange={setTeam}
      options={profile!.teams.map((item) => ({ value: item.teamId, label: item.name }))} />
    <span className="account-name">{profile!.displayName}</span><Button size="small" aria-label="退出" onClick={logout}>退出</Button>
  </header>
    {team ? <ReplayWorkbench key={team} team={team} initial={initial.team === team || !initial.team ? initial : { team, pull: null, view: null, seconds: 0 }} />
      : <main className="loading-panel"><Empty description={initial.team ? "当前账号不属于链接中的团队，请选择已授权团队。" : "账号暂无授权团队，请联系团队管理员。"} /></main>}
  </div></TimelineProvider>;
}

function Content() { const { profile } = useSession(); return profile ? <SignedIn key={profile.userId} /> : <LoginPage />; }

export function App() {
  return <ConfigProvider locale={zhCN} getPopupContainer={(trigger) => trigger?.closest<HTMLElement>(".replay-workspace") ?? document.body}
    theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: "#e51039", colorInfo: "#e51039",
    colorBgContainer: "#141a20", colorBgElevated: "#19212c", colorBorder: "#303946", colorText: "#edf0f4", colorTextSecondary: "#9ca7b5",
    borderRadius: 4, controlHeight: 28, fontSize: 12 } }}>
    <SessionProvider><Content /></SessionProvider>
  </ConfigProvider>;
}
