import { AppShell } from './AppShell'

export function App() {
  return (
    <AppShell
      viewport={
        <div className="visually-hidden" role="status">
          Preparing 3D workcell…
        </div>
      }
    />
  )
}
