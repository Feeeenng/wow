import { Alert } from "antd";
import { usePersonalLiveSession } from "@/features/live/usePersonalLiveSession";
import { useObsSettings } from "@/features/obs/ObsSettingsProvider";
import { LivePreviewPanel } from "@/pages/live/components/LivePreviewPanel";
import { PersonalViewPanel } from "@/pages/live/components/PersonalViewPanel";

interface LivePageProps {
  onOpenSettings: () => void;
}

/** 展示通过本机 WHEP/WebRTC 接收的个人直播视角。 */
export function LivePage({ onOpenSettings }: LivePageProps) {
  const { status, error: obsError } = useObsSettings();
  const session = usePersonalLiveSession(status.liveActive);

  return (
    <div className="mx-auto w-full max-w-[1420px]">
      {obsError && (
        <Alert
          className="mb-4"
          type="warning"
          showIcon
          message="个人视角暂时不可用"
          description={obsError}
        />
      )}
      <div className="space-y-4">
        <LivePreviewPanel
          status={status}
          session={session.session}
          loading={session.loading}
          error={session.error}
          onGoLive={onOpenSettings}
        />
        <PersonalViewPanel status={status} />
      </div>
    </div>
  );
}
