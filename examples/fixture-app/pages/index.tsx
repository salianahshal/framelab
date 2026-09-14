/**
 * The fixture app.
 *
 * It has two jobs. It is what the canvas integration suite drives, and it is
 * the first thing someone points Framelab at to see what it does — so it is a
 * real interface, not a wireframe, and it deliberately contains the awkward
 * cases: a shared component, responsive and state variants, a template literal,
 * a className Framelab refuses to touch, and values that have drifted off the
 * design system.
 *
 * Four things here are a contract with packages/canvas/test/live.js. Change the
 * rest freely; keep these:
 *   - more than 20 tagged elements
 *   - an <h1> wrapping a block <span>, so clicking the headline selects the
 *     span and ArrowUp walks up to the h1
 *   - the h1's className written on one line as a plain string, so a colour
 *     edit produces a one-line diff
 *   - an <a> whose text is exactly "Get started", which the delete test removes
 */
import { useState } from 'react';

/** Used three times below: edit it once and every instance changes. */
function Stat({ label, value, delta }: { label: string; value: string; delta: string }) {
  return (
    <div className="rounded-card border border-offgray-900 bg-surface-1 p-5 shadow-card">
      <p className="text-sm text-offgray-500">{label}</p>
      <p className="mt-2 text-3xl font-medium text-white">{value}</p>
      <p className="mt-1 text-sm text-accent">{delta}</p>
    </div>
  );
}

const rows = [
  { name: 'Acme Corp', plan: 'Enterprise', seats: '240', state: 'Active' },
  { name: 'Northwind', plan: 'Team', seats: '32', state: 'Active' },
  { name: 'Globex', plan: 'Team', seats: '18', state: 'Trialing' },
];

export default function Home() {
  const [tab, setTab] = useState('overview');
  const density = 'py-3';

  return (
    <main className="min-h-screen bg-surface px-gutter py-10">
      <header className="mb-10 flex items-center justify-between border-b border-offgray-900 pb-6">
        <div className="flex items-center gap-3">
          <span className="h-7 w-7 rounded-card bg-brand" />
          <span className="font-medium text-white">Framelab</span>
        </div>
        <nav className="flex items-center gap-6">
          <a className="text-sm text-offgray-400 transition-colors hover:text-white" href="#usage">Usage</a>
          <a className="text-sm text-offgray-400 transition-colors hover:text-white" href="#billing">Billing</a>
          <a className="rounded-card bg-brand px-4 py-2 text-sm text-white transition-colors hover:bg-brand-light" href="#start">Get started</a>
        </nav>
      </header>

      <h1 className="text-[2.5rem] font-medium leading-[1.02] tracking-[-0.03em] text-white sm:text-5xl md:text-6xl">
        <span className="block">Workspace overview</span>
      </h1>
      <p className="mt-4 max-w-prose text-offgray-400">
        Click anything on this page in the Framelab canvas and restyle it. The
        change lands in this file, touching only what you edited.
      </p>

      {/* Three instances of one component — editing Stat changes all of them. */}
      <section id="usage" className="mt-10 grid gap-5 sm:grid-cols-2 md:grid-cols-3">
        <Stat label="Monthly active" value="12,480" delta="+4.2% this month" />
        <Stat label="Seats in use" value="290" delta="+12 this week" />
        <Stat label="Requests" value="1.2M" delta="+18.9% this month" />
      </section>

      {/* This card's values are hardcoded. They match tokens the project
          already has, which is what `framelab drift` is for. */}
      <section className="mt-5 rounded-[14px] bg-[#111114] p-[1.75rem]">
        <h2 className="font-medium text-white">Off the design system</h2>
        <p className="mt-2 text-sm text-offgray-400">
          This block is styled with hardcoded values that tokens already cover.
          Ask an agent to <code className="text-offgray-200">find_drift</code> and it
          will name each one.
        </p>
      </section>

      <section id="billing" className="mt-10">
        <div className="mb-4 flex items-center gap-2">
          {['overview', 'invoices'].map((name) => (
            <button
              key={name}
              onClick={() => setTab(name)}
              /* A ternary className: Framelab refuses to rewrite this rather
                 than guess which branch you meant. It shows as locked. */
              className={tab === name ? 'rounded-card bg-surface-2 px-3 py-1.5 text-sm text-white' : 'rounded-card px-3 py-1.5 text-sm text-offgray-500'}
            >
              {name}
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-card border border-offgray-900">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-1 text-offgray-500">
              <tr>
                <th className={`px-5 ${density} font-normal`}>Account</th>
                <th className={`px-5 ${density} font-normal`}>Plan</th>
                <th className={`px-5 ${density} font-normal`}>Seats</th>
                <th className={`px-5 ${density} font-normal`}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name} className="border-t border-offgray-900">
                  <td className="px-5 py-3 text-white">{row.name}</td>
                  <td className="px-5 py-3 text-offgray-400">{row.plan}</td>
                  <td className="px-5 py-3 text-offgray-400">{row.seats}</td>
                  <td className="px-5 py-3">
                    <span className="rounded-card bg-surface-2 px-2 py-1 text-xs text-accent">{row.state}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="mt-12 flex items-center justify-between border-t border-offgray-900 pt-6">
        <span className="text-sm text-offgray-600">Fixture app</span>
        <a className="text-sm text-offgray-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" href="#start">Docs</a>
      </footer>
    </main>
  );
}
