import { invoke } from "@tauri-apps/api/core";
import type { AnnotationSnapshot, VideoAnnotation } from "@/shared/annotations/model";

/** 本地统一经 LocalStateStore，团队经当前 Rust 身份和版本校验；浏览器不持久化业务内容。 */
export const annotationService = {
  load(source: "local" | "cloud", pullId: string): Promise<AnnotationSnapshot> {
    return invoke(source === "cloud" ? "get_cloud_replay_annotations" : "get_local_replay_annotations", { pullId });
  },
  save(source: "local" | "cloud", pullId: string, expectedVersion: number, items: VideoAnnotation[]): Promise<AnnotationSnapshot> {
    return invoke(source === "cloud" ? "save_cloud_replay_annotations" : "save_local_replay_annotations", { pullId, request: { expectedVersion, items } });
  },
};
