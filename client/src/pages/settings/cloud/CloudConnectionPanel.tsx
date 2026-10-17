import { useEffect, useState } from "react";
import { Alert, Button, Input, Select, Space, Tag } from "antd";
import { useCloud } from "@/features/cloud/CloudProvider";

/** 保存服务器与受限令牌，团队仅来自已验证服务器授予的真实列表。 */
export function CloudConnectionPanel() {
  const cloud = useCloud();
  const [endpoint, setEndpoint] = useState(cloud.settings?.endpoint ?? "");
  const [teamId, setTeamId] = useState<string | null>(cloud.settings?.teamId ?? null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setEndpoint(cloud.settings?.endpoint ?? ""); setTeamId(cloud.settings?.teamId ?? null); }, [cloud.settings?.endpoint, cloud.settings?.teamId]);
  const originChanged = endpoint !== (cloud.settings?.endpoint ?? "");
  const teams = !originChanged ? cloud.settings?.identity?.teams ?? [] : [];
  const submit = async (verify: boolean) => {
    if (busy) return;
    const submittedToken = token;
    setBusy(true); setError(null); setToken("");
    try {
      await cloud.saveSettings({ endpoint, teamId: originChanged ? null : teamId, ...(submittedToken ? { token: submittedToken } : {}) });
      setToken("");
      if (verify) await cloud.verify();
    } catch (failure) { setError(String(failure)); }
    finally { setToken(""); setBusy(false); }
  };
  const clearConnection = async () => {
    setBusy(true); setError(null); setToken("");
    try { await cloud.saveSettings({ endpoint: "", teamId: null }); }
    catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  };
  return <section className="rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-5">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="m-0 text-base font-medium">云端连接</h2>
      <Tag color={cloud.settings?.identity ? "success" : "default"}>{cloud.settings?.identity ? "身份已验证" : "尚未验证"}</Tag>
    </div>
    <p className="mb-5 text-xs leading-5 text-[var(--app-text-secondary)]">配置团队服务器后，可手动上传选中的录像。历史录像不会自动加入上传队列。</p>
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-x-4 gap-y-4 max-[1100px]:grid-cols-1">
      <label htmlFor="cloud-server-endpoint">服务器地址</label>
      <Input id="cloud-server-endpoint" aria-label="云端服务器地址" value={endpoint} placeholder="https://团队服务器地址" autoComplete="url" disabled={busy}
        onChange={(event) => { setEndpoint(event.target.value); setTeamId(null); }} />
      <label htmlFor="cloud-server-token">访问令牌</label>
      <div className="min-w-0 space-y-1.5">
        <Input.Password id="cloud-server-token" aria-label="云端访问令牌" value={token} autoComplete="new-password" disabled={busy} visibilityToggle={false}
          placeholder={cloud.settings?.hasToken && !originChanged ? "已保存令牌，留空保留" : "请输入服务器提供的访问令牌"} onChange={(event) => setToken(event.target.value)} />
        <p className="m-0 text-xs text-[var(--app-text-secondary)]">提交后清空输入，保存的令牌不会返回页面。更换服务器后需要重新提供令牌。</p>
      </div>
      <label htmlFor="cloud-team">上传团队</label>
      <div className="min-w-0 space-y-1.5">
        <Select id="cloud-team" aria-label="云端授权团队" className="w-full" allowClear value={teamId} options={teams.map((team) => ({ value: team.teamId, label: team.name }))}
          disabled={busy || teams.length === 0 || originChanged} placeholder="验证连接后选择已授权团队" onChange={(value) => setTeamId(value ?? null)} />
        {cloud.settings?.identity && !originChanged && teams.length === 0 && <p className="m-0 text-xs text-[var(--app-text-secondary)]">当前账号尚无服务器授权的团队。</p>}
      </div>
    </div>
    <Space className="mt-5" wrap>
      <Button type="primary" aria-label="保存并验证" loading={busy} disabled={!endpoint.trim()} onClick={() => void submit(true)}>保存并验证</Button>
      <Button aria-label="保存设置" loading={busy} disabled={!endpoint.trim()} onClick={() => void submit(false)}>保存设置</Button>
      <Button disabled={busy || cloud.loading} onClick={() => void cloud.refresh().catch((failure) => setError(String(failure)))}>重新读取</Button>
      <Button disabled={busy || !cloud.settings?.endpoint} onClick={() => void clearConnection()}>清除连接设置</Button>
    </Space>
    {(error || cloud.error) && <Alert className="mt-4" type="error" showIcon message="云端操作失败" description={error ?? cloud.error} />}
  </section>;
}
