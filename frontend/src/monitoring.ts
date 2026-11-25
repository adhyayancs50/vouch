import { getEmployerJson } from './api'
import type { InterviewSession } from './sessions'

export interface MonitoringView {
  session_id: string
  session_status: InterviewSession['status']
  candidate: InterviewSession['candidate']
  consent: {
    status: 'NONE' | 'GRANTED' | 'DECLINED' | 'WITHDRAWN'
    consent_version: string | null
    updated_at: string | null
    history: { decision: 'GRANTED' | 'DECLINED' | 'WITHDRAWN'; consent_version: string | null; recorded_at: string }[]
  }
  monitoring: {
    status: 'NOT_STARTED' | 'ACTIVE' | 'STOPPED'
    started_at: string | null
    stopped_at: string | null
    stop_reason: 'CANDIDATE_STOPPED' | 'CONSENT_WITHDRAWN' | null
    events_received: number
    last_event_received_at: string | null
  }
}

export interface BrowserEvent {
  event_id: string
  event_type: 'TAB_SWITCH' | 'WEBSITE_NAVIGATION'
  hostname: string | null
  tab_id: number | null
  occurred_at: string
  received_at: string
  client_sequence: number
  server_sequence: number
}

export interface EventPage {
  session_id: string
  total_events: number
  limit: number
  offset: number
  events: BrowserEvent[]
}

export const EVENT_PAGE_SIZE = 50

export function formatMonitoringDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
}

export async function getMonitoring(id: string): Promise<MonitoringView> {
  return await getEmployerJson(`/api/sessions/${encodeURIComponent(id)}/monitoring`) as MonitoringView
}

export async function getEvents(id: string, offset = 0): Promise<EventPage> {
  return await getEmployerJson(`/api/sessions/${encodeURIComponent(id)}/events?limit=${EVENT_PAGE_SIZE}&offset=${offset}`) as EventPage
}

// Offset pagination can overlap if a delayed event arrives between requests.
export function mergeEvents(previous: BrowserEvent[], incoming: BrowserEvent[]): BrowserEvent[] {
  return [...new Map([...previous, ...incoming].map(event => [event.event_id, event])).values()]
    .sort((a, b) => a.client_sequence - b.client_sequence || a.server_sequence - b.server_sequence)
}

export function monitoringMessage(view: MonitoringView): string {
  if (view.consent.status === 'WITHDRAWN') return 'Consent withdrawn. Monitoring is not active in this snapshot.'
  if (view.monitoring.status === 'STOPPED') return 'Monitoring stopped. Recorded activity remains available below; monitoring cannot restart.'
  if (view.session_status === 'CREATED') return 'Waiting for the candidate to join. Joining alone does not grant consent.'
  if (view.consent.status === 'DECLINED') return 'The candidate declined consent. Monitoring has not started.'
  if (view.consent.status === 'NONE') return 'Candidate joined. Waiting for the candidate to grant consent.'
  if (view.monitoring.status === 'ACTIVE') return 'Monitoring was active at the last successful refresh. Refresh to check its current state.'
  return 'Consent granted. Waiting for the candidate to start monitoring in the extension.'
}

// Defense in depth: never render a URL or path even if a malformed response contains one.
export function displayHostname(hostname: string | null): string {
  const label = '(?!-)[a-z0-9-]{1,63}(?<!-)'
  return hostname && new RegExp(`^(?=.{1,253}$)${label}(\\.${label})*$`, 'i').test(hostname)
    ? hostname : 'Hostname unavailable (non-web tab or not recorded)'
}
