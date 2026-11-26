import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider } from './store'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import TimerPage from './pages/Timer'
import Capture from './pages/Capture'
import Grade from './pages/Grade'
import WrongBook from './pages/WrongBook'
import Analytics from './pages/Analytics'
import Mock from './pages/Mock'
import Vocabulary from './pages/Vocabulary'
import Plan from './pages/Plan'
import Settings from './pages/Settings'

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/timer" element={<TimerPage />} />
            <Route path="/capture" element={<Capture />} />
            <Route path="/grade" element={<Grade />} />
            <Route path="/wrong" element={<WrongBook />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/mock" element={<Mock />} />
            <Route path="/vocab" element={<Vocabulary />} />
            <Route path="/plan" element={<Plan />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </AppProvider>
    </BrowserRouter>
  )
}