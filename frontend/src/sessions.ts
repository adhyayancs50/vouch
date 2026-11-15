import { getEmployerJson, postEmployerJson } from './api'

export const AI_POLICIES = {
  PROHIBITED: 'Prohibited',
  PARTIALLY_ALLOWED: 'Partially allowed',
  ALLOWED: 'Allowed',
} as const

export type AiUsage = keyof typeof AI_POLICIES
export interface Policy {
  ai_usage: AiUsage
  allowed_domains: string[]
  restricted_domains: string[]
}
export interface InterviewSession {
  session_id: string
  title: string
  candidate_name: string | null
  status: 'CREATED' | 'JOINED'
  policy: Policy
  created_at: string
  join_code_expires_at: string
  joined_at: string | null
  candidate: { candidate_id: string; name: string | null; joined_at: string } | null
}
export interface CreateSessionInput {
  title: string
  candidate_name?: string
  policy: Policy
}
export interface SessionList {
  total_sessions: number
  sessions: InterviewSession[]
}

export async function listSessions(): Promise<SessionList> {
  return await getEmployerJson('/api/sessions') as SessionList
}

export async function getSession(id: string): Promise<InterviewSession> {
  return await getEmployerJson(`/api/sessions/${encodeURIComponent(id)}`) as InterviewSession
}

export async function createSession(input: CreateSessionInput): Promise<{ session: InterviewSession; joinCode: string }> {
  const { candidate_join_code, ...session } = await postEmployerJson('/api/sessions', input) as InterviewSession & { candidate_join_code: string }
  // Keep the one-time code separate from list/detail state.
  return { session, joinCode: candidate_join_code }
}

export function parseDomains(value: string): string[] {
  const entries = value.split(/[,\s]+/).filter(Boolean)
  if (entries.length > 50) throw new Error('Enter at most 50 hostnames in each domain list.')
  const domains = entries.map(entry => entry.toLowerCase().replace(/\.+$/, '').replace(/^www\./, ''))
  const hostname = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/
  if (domains.some(domain => !hostname.test(domain))) {
    throw new Error('Use hostnames such as chatgpt.com, without https://, paths or ports. Separate them with commas or new lines.')
  }
  return [...new Set(domains)]
}

export function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
