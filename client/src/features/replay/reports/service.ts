import { invoke } from "@tauri-apps/api/core";
import type { WclActorBinding, WclReportStatus } from "@/shared/replay/reports";

/** WCL 凭证只存在服务端；页面仅提交公开报告身份和显式人物绑定。 */
export const wclReportService = {
  get(pullId: string): Promise<WclReportStatus> {
    return invoke("get_cloud_wcl_status", { pullId });
  },
  start(pullId: string, request: { reportCode: string; fightId: number; actorBindings: WclActorBinding[]; refresh?: boolean }): Promise<WclReportStatus> {
    return invoke("start_cloud_wcl_import", { pullId, request });
  },
};
