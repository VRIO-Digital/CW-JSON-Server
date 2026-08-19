import React, { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { tenant, personas, people } from '../lib/db.js'
import { Toasts, ProvPopover } from './Primitives.jsx'

/* ══════════════════════════════════════════════════════════════════ SHELL ══
   Sidebar, topbar, content.

   THE NAV LISTS WHAT THIS BUILD SHIPS. The prototype's rail carried twelve views;
   this is the report layer, so it carries two — the library and whichever report is
   open. A nav offering a shortcut to a view that does not exist is a dead end
   dressed as a feature, which is the same reason the prototype hid its
   notifications button for personas whose workspace has no catalogue.

   SIGNED IN AS, NOT "VIEWING AS". There is no dropdown here. A persona is
   established at login and carries a scope predicate the server applies, so
   changing it is a sign-out and a sign-in, not a filter — and the scope line is the
   predicate the session resolved, in business language, because a viewer who cannot
   see what is being withheld cannot tell an empty screen from a scoped one.

   The persona shown is READ OFF THE RESOLVED VIEW, never chosen here. Every run in
   db.json was resolved for the Domain Architect, which is how the three standalone
   pages were produced.
   ========================================================================== */
export default function Shell({ persona, scopeLabel, crumb, children }) {
  /* The theme is read off the document rather than defaulted, because index.html
     ships `data-theme="light"` on <html> the way the three standalone report pages
     did, and a component that assumes its own default would flash the other theme
     on first paint. Guarded because this component is rendered without a document
     by the smoke test — reaching for `document` during render is also the thing
     that would break the moment anyone server-renders a page. */
  const [theme, setTheme] = useState(() =>
    (typeof document === 'undefined'
      ? 'light'
      : document.documentElement.getAttribute('data-theme') || 'light'))
  const loc = useLocation()

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])

  const person = persona ? people[persona.person] : null
  const name = person ? person.name : (persona ? persona.label : '—')
  const initials = person ? person.initials : '—'

  return (
    <div className="app">
      <aside className="side">
        <div className="logo">
          <div className="wordmark">Context<b>Weave</b></div>
          <div className="tag">From Data to Decisions — with Context</div>
        </div>

        <nav className="nav">
          <Link className={'nitem' + (loc.pathname === '/' ? ' on' : '')} to="/">
            <span className="ic">▦</span>Reports
          </Link>
        </nav>

        {persona ? (
          <div className="roleBox">
            <div className="lbl">Signed in as</div>
            <div className="pChip">
              <div className="pAv">{initials}</div>
              <div className="pWho">
                <div className="pName">{name}</div>
                <div className="pTitle">{person ? person.title : persona.label}</div>
              </div>
            </div>
            {/* The predicate the session resolved, in business language — not the
                predicate itself, which is in the drawer under Audit. */}
            <div className="pScope">{scopeLabel || persona.canSee || ''}</div>
          </div>
        ) : null}
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="crumb">{crumb || <b>Reports</b>}</div>
          <div className="grow" />
          <span className="envPill">
            {tenant.shortName} · {tenant.environment} · as of {tenant.asOf}
          </span>
          <button className="iconBtn" title="Toggle theme" id="themeBtn"
                  onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}>◐</button>
        </div>

        <div className="content">{children}</div>
      </div>

      <Toasts />
      <ProvPopover />
    </div>
  )
}
