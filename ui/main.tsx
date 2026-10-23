import * as React from 'react'
import { App } from './App.tsx'

const PANEL = 'workbench'
export const inject = ['slots', 'uiWorkspace']

function Icon({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <rect x={3} y={4} width={18} height={16} rx={3} /><path d="M8 8v8M12 8v5M16 8v10" />
    </svg>
  )
}

export function apply(ctx: any) {
  const openSession = (id: string) => { try { ctx.uiWorkspace.openSession(id) } catch (e) { console.warn('[workbench] openSession failed', e) } }
  const Page = () => <App openSession={openSession} />
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, Page))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 20, label: () => '工作台' }, Icon))
}
