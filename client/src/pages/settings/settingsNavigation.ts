import {
  BellOutlined,
  CloudUploadOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  SettingOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";

export type SettingsSection = "obs" | "general" | "combat-log" | "game" | "storage" | "updates";

export const settingsNavigation = [
  { key: "obs", label: "OBS 设置", icon: VideoCameraOutlined },
  { key: "general", label: "常规设置", icon: SettingOutlined },
  { key: "combat-log", label: "战斗日志", icon: FileTextOutlined },
  { key: "game", label: "游戏路径", icon: FolderOpenOutlined },
  { key: "storage", label: "上传与存储", icon: CloudUploadOutlined },
  { key: "updates", label: "通知与更新", icon: BellOutlined },
] satisfies Array<{ key: SettingsSection; label: string; icon: typeof SettingOutlined }>;
