import { App, Button, Form, Input, Typography } from 'antd'
import { Navigate, useLocation, useNavigate, type Location } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import './LoginPage.css'

interface LoginFields {
  email: string
  password: string
}

/**
 * Where signing in lands.
 *
 * **Ask, because that is what the console is for** — a question put to the published graph, rather than
 * the plumbing that produced it. It was Sources, which was right when connecting one was the first thing
 * anybody did.
 *
 * The `/` index redirect in `routes.tsx` points at the same place, so the two cannot disagree about where
 * "no particular page" means.
 */
const LANDING = '/ask'

/**
 * The only page outside the app shell — no sidebar, because there is nothing
 * to navigate to yet. Gated in from `RequireAuth` in routes.tsx, not here: this
 * component's only job is to collect an identity and hand it to the store.
 *
 * **There is no role picker, and there was.** The form used to ask which persona you were, which meant
 * one address could sign in as any of them — the dropdown *was* the whole of "who are you". The persona
 * is now the user's own, looked up by email in the settings store, so the form collects two fields and
 * the server answers with the role. Two consequences worth knowing:
 *
 * - **An unknown address is refused**, naming the people Settings knows. The old form accepted any
 *   well-formed email because there was nothing to check it against; now there is a user list.
 * - **The roles endpoint is no longer read here.** It was fetched only to fill the dropdown, and a whole
 *   error-and-retry path existed for the case where it failed. Both are gone, along with the failure mode
 *   where an unreachable server showed an empty Select and no reason.
 *
 * It is still not authentication: the password is length-checked and nothing more. What changed is that
 * the persona is *looked up* rather than claimed.
 */
export default function LoginPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const [form] = Form.useForm<LoginFields>()

  const identity = useAuthStore((s) => s.identity)
  const signingIn = useAuthStore((s) => s.signingIn)
  const login = useAuthStore((s) => s.login)

  /*
   * Where signing in lands: `LANDING`, unless the visitor was bounced off somewhere.
   *
   * A **fallback, not an override** — a protected page redirects here with its own location in
   * `state.from`, and going back there is the whole reason that state exists.
   */
  const destination = () =>
    (location.state as { from?: Location } | null)?.from?.pathname ?? LANDING

  // Already signed in — a direct visit to /login should not re-collect one.
  if (identity) {
    return <Navigate to={destination()} replace />
  }

  // antd only calls this once every field has already passed its own rules.
  async function handleFinish(values: LoginFields) {
    const result = await login({ email: values.email, password: values.password })
    if (!result.ok) {
      /* The server's own sentence, which for an unknown address lists who is set up. */
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

          <Button type="primary" htmlType="submit" block size="large" loading={signingIn}>
            Sign in
          </Button>
        </Form>

        <Typography.Text type="secondary" className="login-note">
          A persona demo, not a user directory. Your persona comes from the user list in Settings — sign
          in with an address it knows and any password of six characters or more. The connector consent
          screens work the same way: they prove a request is well formed, not that an account is real.
        </Typography.Text>
      </div>
    </div>
  )
}
