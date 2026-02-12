import React from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { TerminalPanel } from './TerminalPanel'

interface AppShellProps {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="h-screen flex flex-col bg-void overflow-hidden">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <main className="flex-1 overflow-y-auto scrollbar-thin p-6">
            {children}
          </main>
          <TerminalPanel />
        </div>
      </div>
    </div>
  )
}
