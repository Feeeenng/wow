import { Alert } from "antd";
import { usePersonalLiveSession } from "@/features/live/usePersonalLiveSession";
import { useObsSettings } from "@/features/obs/ObsSettingsProvider";
import { LivePreviewPanel } from "@/pages/live/components/LivePreviewPanel";
import { PersonalViewPanel } from "@/pages/live/components/PersonalViewPanel";

interface LivePageProps {
  visible: boolean;
  onOpenSettings: () => void;
}

/** 常驻展示本机 WHEP/WebRTC 个人视角，由上层控制可见性。 */
export function LivePage({ visible, onOpenSettings }: LivePageProps) {
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
          visible={visible}
          onGoLive={onOpenSettings}
        />
        <PersonalViewPanel status={status} />
      </div>
    </div>
  );
}
