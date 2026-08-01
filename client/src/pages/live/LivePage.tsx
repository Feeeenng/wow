import { ComingSoon } from "@/components/feedback/ComingSoon";

/** 展示团队实时状态；第一阶段不提供公开直播推流。 */
export function LivePage() {
  return <ComingSoon title="暂无进行中的活动" description="进入团队副本后，这里将显示当前 Pull 和采集状态。" />;
}
