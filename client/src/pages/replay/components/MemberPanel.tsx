import {
  HeartOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  AimOutlined,
} from "@ant-design/icons";
import { Badge, Tooltip } from "antd";
import type { ComponentType } from "react";
import type { ReplayMember, ReplayRole } from "@/pages/replay/model";

interface MemberPanelProps {
  members: ReplayMember[];
  selectedMemberId: string;
  onMemberChange: (memberId: string) => void;
}

const roleGroups: Array<{
  role: ReplayRole;
  label: string;
  icon: ComponentType;
}> = [
  { role: "tank", label: "坦克", icon: SafetyCertificateOutlined },
  { role: "healer", label: "治疗", icon: HeartOutlined },
  { role: "melee", label: "近战", icon: ThunderboltOutlined },
  { role: "ranged", label: "远程", icon: AimOutlined },
];

/** 按职责分组展示有限成员 fixture，并切换当前第一视角。 */
export function MemberPanel({ members, selectedMemberId, onMemberChange }: MemberPanelProps) {
  return (
    <aside className="min-w-0 self-start rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)]">
      <div className="border-b border-[var(--app-border)] px-3 py-3">
        <strong className="text-sm font-medium">成员视角</strong>
        <p className="mt-1 text-xs text-[var(--app-text-secondary)]">{members.length} 个成员</p>
      </div>
      <div className="divide-y divide-[var(--app-border)]">
        {roleGroups.map(({ role, label, icon: RoleIcon }) => {
          const roleMembers = members.filter((member) => member.role === role);
          return (
            <section key={role} className="px-2 py-3">
              <div className="mb-2 flex items-center gap-2 px-1 text-xs font-medium text-[var(--app-text-secondary)]">
                <RoleIcon />
                <span>{label}</span>
                <span>({roleMembers.length})</span>
              </div>
              <div className="space-y-1">
                {roleMembers.map((member) => {
                  const selected = member.id === selectedMemberId;
                  const disabled = member.status === "processing";
                  const button = (
                    <button
                      key={member.id}
                      className={`flex w-full min-w-0 items-center gap-2 rounded-[4px] border px-2 py-2 text-left transition-colors ${selected ? "border-[var(--app-primary)] bg-[color-mix(in_srgb,var(--app-primary)_8%,transparent)]" : "border-transparent hover:bg-[var(--app-bg)]"} ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                      type="button"
                      disabled={disabled}
                      aria-pressed={selected}
                      onClick={() => onMemberChange(member.id)}
                    >
                      <Badge status={disabled ? "default" : "success"} dot offset={[-3, 40]}>
                        <img
                          className="h-11 w-11 shrink-0 rounded-[4px] border border-[var(--app-border)] object-cover"
                          src={member.avatar}
                          alt=""
                        />
                      </Badge>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{member.name}</span>
                        <span className="block truncate text-xs text-[var(--app-text-secondary)]">
                          {disabled ? "录像处理中" : member.specialization}
                        </span>
                      </span>
                    </button>
                  );
                  return disabled ? (
                    <Tooltip key={member.id} title="该成员录像仍在处理，暂不可切换">
                      <span className="block">{button}</span>
                    </Tooltip>
                  ) : button;
                })}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
