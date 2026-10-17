import { useState } from "react";
import { Alert, Button, Input } from "antd";
import { PlayCircleOutlined } from "@ant-design/icons";
import { useSession } from "@/auth/SessionProvider";
import { MAX_TOKEN_CHARS } from "@/config";
import { errorMessage } from "@/auth/api";

/** 复用现有平台身份；令牌输入在每次提交后清空，不进入URL或浏览器存储。 */
export function LoginPage() {
  const { login } = useSession();
  const [token, setToken] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (busy || !token.trim()) return; const value = token.trim(); setBusy(true); setError(null);
    try { await login(value); } catch (failure) { setError(errorMessage(failure)); }
    finally { setToken(""); setBusy(false); }
  };
  return <main className="login-screen"><section className="login-card">
    <PlayCircleOutlined className="login-logo" />
    <h1>团队战斗复盘</h1><p>查看团队录像，沿战斗时间轴切换成员视角。</p>
    {error && <Alert type="error" showIcon message={error} />}
    <label htmlFor="access-token">访问令牌</label>
    <Input.Password id="access-token" aria-label="访问令牌" autoComplete="off" value={token} maxLength={MAX_TOKEN_CHARS}
      disabled={busy} onChange={(event) => setToken(event.target.value)} onPressEnter={() => void submit()} />
    <Button type="primary" aria-label="验证并进入" loading={busy} disabled={!token.trim()} onClick={() => void submit()}>验证并进入</Button>
    <span className="muted">使用团队管理员为你颁发的访问令牌。退出或刷新页面后需要重新验证。</span>
  </section></main>;
}
