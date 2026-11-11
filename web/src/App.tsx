import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { configError } from './lib/supabase'
import { SessionProvider, useSession } from './state/session'
import { Layout } from './components/Layout'
import { Empty, Loading, ToastProvider } from './components/ui'
import { SignIn } from './pages/SignIn'
import { Onboarding } from './pages/Onboarding'
import { Browse } from './pages/Browse'
import { ItemForm } from './pages/ItemForm'
import { ItemDetail } from './pages/ItemDetail'
import { Requests } from './pages/Requests'
import { Loans } from './pages/Loans'
import { LoanDetail } from './pages/LoanDetail'
import { Alerts } from './pages/Alerts'
import { Profile } from './pages/Profile'
import { CircleAdmin } from './pages/CircleAdmin'

function Gate() {
  const { ready, session, activeCircles } = useSession()
  if (!ready) return <Loading label="Starting" />
  if (!session) return <SignIn />
  return (
    <Routes>
      <Route path="/join" element={<Onboarding />} />
      {activeCircles.length === 0 ? (
        <Route path="*" element={<Onboarding />} />
      ) : (
        <Route element={<Layout />}>
          <Route index element={<Browse />} />
          <Route path="items/new" element={<ItemForm />} />
          <Route path="items/:id" element={<ItemDetail />} />
          <Route path="items/:id/edit" element={<ItemForm />} />
          <Route path="requests" element={<Requests />} />
          <Route path="requests/:id" element={<Navigate to="/requests" replace />} />
          <Route path="loans" element={<Loans />} />
          <Route path="loans/:id" element={<LoanDetail />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="me" element={<Profile />} />
          <Route path="circle/:id/members" element={<CircleAdmin />} />
          <Route path="*" element={<Empty title="Page not found" />} />
        </Route>
      )}
    </Routes>
  )
}

export default function App() {
  if (configError) {
    return <main className="mx-auto max-w-lg p-8"><Empty title="Setup needed">{configError}</Empty></main>
  }
  return (
    <BrowserRouter>
      <ToastProvider>
        <SessionProvider>
          <Gate />
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
