import React from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ReportStateProvider } from './state/ReportState.jsx'
import LibraryPage from './pages/LibraryPage.jsx'
import ReportPage from './pages/ReportPage.jsx'

/* Two routes, because there are two pages: the library, and one report. The three
   published reports share the report route — the prototype's three standalone
   files differ by one line naming a report id, and the same property holds here. */
export default function App() {
  return (
    <ReportStateProvider>
      <Routes>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/reports/:slug" element={<ReportPage />} />
        {/* An unknown address lands on the library rather than on a blank page:
            the library is the answer to "what is here". */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ReportStateProvider>
  )
}
