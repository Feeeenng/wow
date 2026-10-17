"""个人布局的稳定契约边界，与 shared/replay/config 及 Rust 保存边界一致。"""

TRACK_LIMIT = 8
CUSTOM_TRACK_PREFIX = "custom-"
TRACK_NAME_MAX = 32
OVERRIDE_LIMIT = 1024
OVERRIDE_KEY_BYTES = 160
VERSION_MAX = (1 << 32) - 1
HEIGHT_RANGE = (20, 50)
ICON_RANGE = (50, 100)
ZOOM_RANGE = (1, 4)
ZOOM_STEP = 0.5
DEFAULT_HEIGHT = 30
DEFAULT_ICON_PERCENT = 80
DEFAULT_ZOOM = 1
DEFAULT_TRACKS = {"boss", "player", "team", "aura", "death"}
EVENT_KINDS = {"castStart", "castSuccess", "empowerStart", "empowerEnd", "empowerInterrupt",
    "resurrect", "death", "buffApply", "buffRefresh", "buffRemove", "buffStack", "debuffApply",
    "debuffRefresh", "debuffRemove", "debuffStack", "interrupt", "dispel"}
