import FileDropGuard from './components/FileDropGuard'
import AppRouter from './router'
import PrivacyBoundary from './components/privacy/PrivacyBoundary'

export default function App() {
  return (
    <PrivacyBoundary>
      <FileDropGuard />
      <AppRouter />
    </PrivacyBoundary>
  )
}
