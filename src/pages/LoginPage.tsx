import { Alert, App, Button, Form, Input, Select, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate, type Location } from 'react-router-dom'
import { listAuthRoles, type AuthRole } from '../api/client'
import { toMessage } from '../store/asyncState'
import { useAuthStore } from '../store/authStore'
import './LoginPage.css'

interface LoginFields {
  email: string
  password: string
  roleId: string
}

/**
 * The only page outside the app shell — no sidebar, because there is nothing
 * to navigate to yet. Gated in from `RequireAuth` in routes.tsx, not here: this
 * component's only job is to collect an identity and hand it to the store.
 */
export default function LoginPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const [form] = Form.useForm<LoginFields>()

  const identity = useAuthStore((s) => s.identity)
  const signingIn = useAuthStore((s) => s.signingIn)
  const login = useAuthStore((s) => s.login)

  // The role dropdown is a one-shot read local to this form — not worth a
  // store of its own, the same call EditDatasetsModal makes for its list.
  const [roles, setRoles] = useState<AuthRole[]>([])
  const [rolesLoading, setRolesLoading] = useState(false)
  /*
   * Kept in state, not just flashed as a toast. A dropdown that is simply empty
   * reads as "this app has no roles" — the failure has to name itself and offer
   * the way out, or the only visible symptom of an unreachable/stale server is a
   * blank Select. That is exactly how this page first went wrong.
   */
  const [rolesError, setRolesError] = useState<string | null>(null)

  const loadRoles = useCallback(() => {
    setRolesLoading(true)
    listAuthRoles()
      .then((result) => {
        setRoles(result.roles)
        setRolesError(null)
      })
      .catch((error) => setRolesError(toMessage(error)))
      .finally(() => setRolesLoading(false))
  }, [])

  useEffect(loadRoles, [loadRoles])

  const destination = () =>
    (location.state as { from?: Location } | null)?.from?.pathname ?? '/sources'

  // Already signed in — a direct visit to /login should not re-collect one.
  if (identity) {
    return <Navigate to={destination()} replace />
  }

  // antd only calls this once every field has already passed its own rules.
  async function handleFinish(values: LoginFields) {
    const result = await login({
      email: values.email,
      password: values.password,
      roleId: values.roleId,
    })
    if (!result.ok) {
      message.error(result.error)
      return
    }
    navigate(destination(), { replace: true })
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <Typography.Title level={3} className="login-wordmark">
            Context<span>Weave</span>
          </Typography.Title>
          <Typography.Text className="login-tagline">
            FROM DATA TO DECISIONS
          </Typography.Text>
        </div>

        <Form form={form} layout="vertical" requiredMark={false} onFinish={handleFinish}>
          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Enter your email.' },
              { type: 'email', message: 'Enter a valid email address.' },
            ]}
          >
            <Input placeholder="you@company.com" autoComplete="username" autoFocus />
          </Form.Item>

          <Form.Item
            name="password"
            label="Password"
            rules={[
              { required: true, message: 'Enter your password.' },
              { min: 6, message: 'Password must be at least 6 characters.' },
            ]}
          >
            <Input.Password placeholder="••••••••" autoComplete="current-password" />
          </Form.Item>

          {rolesError ? (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
              title="Could not load the roles"
              description={
                <>
                  <div style={{ marginBottom: 8 }}>{rolesError}</div>
                  <div style={{ marginBottom: 12 }}>
                    Sign-in needs the role list, so the dropdown stays empty until
                    this succeeds. If the mock server was restarted after this page
                    loaded, retrying is enough.
                  </div>
                  <Button size="small" onClick={loadRoles} loading={rolesLoading}>
                    Retry
                  </Button>
                </>
              }
            />
          ) : null}

          <Form.Item
            name="roleId"
            label="Role"
            rules={[{ required: true, message: 'Pick a role before signing in.' }]}
          >
            <Select
              placeholder={rolesError ? 'No roles loaded' : 'Select a role'}
              loading={rolesLoading}
              disabled={roles.length === 0}
              // A dropdown with nothing in it must say why, not just open empty.
              notFoundContent={rolesLoading ? 'Loading roles…' : 'No roles available'}
              options={roles.map((r) => ({ value: r.roleId, label: r.label }))}
            />
          </Form.Item>

          <Button type="primary" htmlType="submit" block size="large" loading={signingIn}>
            Sign in
          </Button>
        </Form>

        <Typography.Text type="secondary" className="login-note">
          This is a persona demo — any password signs you in as the role you pick,
          the same way the connector consent screens do not check a real Google
          account.
        </Typography.Text>
      </div>
    </div>
  )
}
