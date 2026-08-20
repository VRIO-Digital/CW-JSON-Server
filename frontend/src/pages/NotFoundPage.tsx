import { Button, Result } from 'antd'
import { Link } from 'react-router-dom'
import { appPath } from '../api/dataset'

export default function NotFoundPage() {
  return (
    <Result
      status="404"
      title="Page not found"
      subTitle="That route does not exist. Pick a section from the sidebar to continue."
      extra={
        <Link to={appPath('/sources')}>
          <Button type="primary">Back to Sources</Button>
        </Link>
      }
    />
  )
}
