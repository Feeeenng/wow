"""将各录像的本地日志起点转换为团队统一战斗起点。"""


def common_pull_mapping(manifest: dict, common_start_ms: int) -> dict:
    """只转换响应副本，不修改原 manifest、媒体坐标或幂等身份。"""
    delta = manifest["encounterStartUnixMs"] - common_start_ms
    return {"videoZeroMs": manifest["videoZeroMs"] - delta, "videoDurationMs": manifest["videoDurationMs"],
        "intervals": [{**interval, "pullStartMs": interval["pullStartMs"] + delta,
                       "pullEndMs": interval["pullEndMs"] + delta} for interval in manifest["intervals"]],
        "hasGap": manifest.get("hasGap", False), "clockDiscontinuous": manifest.get("clockDiscontinuous", False),
        "mediaCalibrated": manifest.get("mediaCalibrated", False), "calibrationError": manifest.get("calibrationError")}
