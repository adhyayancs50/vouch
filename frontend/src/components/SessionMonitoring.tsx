import { useEffect, useRef, useState } from 'react'
import { displayHostname, formatMonitoringDate, getEvents, getMonitoring, mergeEvents, monitoringMessage } from '../monitoring'
import type { BrowserEvent, MonitoringView } from '../monitoring'

function timestamp(value: string | null) {
  return value ? formatMonitoringDate(value) : 'Not recorded'
}

export function MonitoringStatus({ view, fetchedAt }: { view: MonitoringView; fetchedAt: string }) {
  return <>
    <p className="monitoring-summary" role="status">{monitoringMessage(view)}</p>
    <p className="field-hint">State snapshot fetched {formatMonitoringDate(fetchedAt)}. Manual refresh only; this is not a live feed.</p>
    <dl className="details-grid">
      <div><dt>Session status</dt><dd>{view.session_status}</dd></div>
      <div><dt>Joined candidate</dt><dd>{view.candidate?.name || 'Not provided'}</dd></div>
      <div><dt>Consent status</dt><dd>{view.consent.status}</dd></div>
      <div><dt>Monitoring status (at refresh)</dt><dd>{view.monitoring.status}</dd></div>
      <div><dt>Monitoring started</dt><dd>{timestamp(view.monitoring.started_at)}</dd></div>
      <div><dt>Monitoring stopped</dt><dd>{timestamp(view.monitoring.stopped_at)}</dd></div>
      <div><dt>Stop reason</dt><dd>{view.monitoring.stop_reason === 'CANDIDATE_STOPPED' ? 'Candidate stopped monitoring' : view.monitoring.stop_reason === 'CONSENT_WITHDRAWN' ? 'Consent withdrawn' : 'Not applicable'}</dd></div>
      <div><dt>Browser events received (at refresh)</dt><dd>{view.monitoring.events_received}</dd></div>
      <div><dt>Last event received by backend</dt><dd>{timestamp(view.monitoring.last_event_received_at)}</dd></div>
    </dl>
  </>
}

export function ActivityTimeline({ events }: { events: BrowserEvent[] }) {
  if (!events.length) return <p className="activity-empty">No browser events recorded in this snapshot. Activity appears only after consent and monitoring start; an empty history does not establish what the candidate did.</p>
  return <ol className="activity-timeline" aria-label="Observed browser activity, ordered by client sequence then server sequence">
    {events.map(event => <li key={event.event_id} className={`activity-event ${event.event_type === 'TAB_SWITCH' ? 'tab-switch' : 'website-navigation'}`}>
      <div className="activity-event-heading"><strong>{event.event_type === 'TAB_SWITCH' ? 'Tab switch' : 'Website navigation'}</strong><span className="badge">{event.event_type}</span></div>
      <p className="activity-hostname">{displayHostname(event.hostname)}</p>
      <p className="field-hint">Browser time: <time dateTime={event.occurred_at}>{formatMonitoringDate(event.occurred_at)}</time> · Sequence {event.client_sequence} / {event.server_sequence}{event.tab_id !== null && ` · Tab ${event.tab_id}`}</p>
    </li>)}
  </ol>
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The request failed. Please try again.'

export function SessionMonitoring({ sessionId, revision }: { sessionId: string; revision: number }) {
  const [view, setView] = useState<MonitoringView | null>(null)
  const [events, setEvents] = useState<BrowserEvent[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [stateFetchedAt, setStateFetchedAt] = useState('')
  const [eventsFetchedAt, setEventsFetchedAt] = useState('')
  const [stateError, setStateError] = useState('')
  const [eventsError, setEventsError] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)
  const pagePending = useRef(false)

  useEffect(() => {
    const current = ++generation.current
    setLoading(true)
    setLoadingMore(false)
    pagePending.current = false
    setStateError('')
    setEventsError('')
    // Each resource can recover independently. Retain the previous snapshot on failure.
    const state = getMonitoring(sessionId).then(data => {
      if (generation.current !== current) return
      setView(data)
      setStateFetchedAt(new Date().toISOString())
    }).catch(error => { if (generation.current === current) setStateError(errorMessage(error)) })
    const activity = getEvents(sessionId).then(data => {
      if (generation.current !== current) return
      setEvents(mergeEvents([], data.events))
      setTotal(data.total_events)
      setOffset(data.offset + data.events.length)
      setEventsFetchedAt(new Date().toISOString())
    }).catch(error => { if (generation.current === current) setEventsError(errorMessage(error)) })
    void Promise.allSettled([state, activity]).then(() => { if (generation.current === current) setLoading(false) })
    return () => { generation.current++ }
  }, [sessionId, revision, retry])

  async function loadMore() {
    if (pagePending.current || loading) return
    pagePending.current = true
    const current = generation.current
    setLoadingMore(true)
    setEventsError('')
    try {
      const data = await getEvents(sessionId, offset)
      if (generation.current !== current) return
      if (!data.events.length && data.total_events > offset) throw new Error('No additional events returned. Refresh monitoring to reload the timeline.')
      setEvents(previous => mergeEvents(previous, data.events))
      setTotal(data.total_events)
      setOffset(data.offset + data.events.length)
      setEventsFetchedAt(new Date().toISOString())
    } catch (error) {
      if (generation.current === current) setEventsError(errorMessage(error))
    } finally {
      if (generation.current === current) {
        setLoadingMore(false)
        pagePending.current = false
      }
    }
  }

  return <section className="monitoring-section" aria-labelledby="monitoring-heading" aria-busy={loading || loadingMore}>
    <div className="monitoring-heading"><h3 id="monitoring-heading">Consent &amp; monitoring</h3><button className="connection-button" type="button" disabled={loading || loadingMore} onClick={() => setRetry(value => value + 1)}>Refresh monitoring &amp; events</button></div>
    {loading && <p role="status">Fetching monitoring state and the first page of events…</p>}
    {stateError && <p role="alert" className="connection-error">Monitoring state could not be refreshed. {stateError} {view && 'The previous state snapshot is shown below.'} Use Refresh monitoring &amp; events to retry.</p>}
    {view && <MonitoringStatus view={view} fetchedAt={stateFetchedAt} />}
    <h3 className="activity-heading">Observed browser activity</h3>
    <p className="field-hint">These events represent browser activity observed by the Chrome extension during consented monitoring, within its permitted scope. They do not establish AI use, cheating, or a policy violation. Only hostnames are shown.</p>
    <p className="field-hint">Ordered by client sequence, then server sequence, rather than browser time, which may be inaccurate. Dates use your local time.</p>
    {eventsError && <p role="alert" className="connection-error">Browser events could not be loaded. {eventsError} {eventsFetchedAt && 'Previously fetched events are retained.'} Retry Load More or refresh monitoring &amp; events.</p>}
    {eventsFetchedAt && <>
      <p className="field-hint">Events last fetched {formatMonitoringDate(eventsFetchedAt)} · Showing {events.length} of {total} events at that request. State and events are fetched separately and may differ.</p>
      <ActivityTimeline events={events} />
      <p className="field-hint">Delayed submissions can change page boundaries. Refresh reloads the first page to check the latest ordering.</p>
      {offset < total && <button className="connection-button" type="button" disabled={loading || loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading more events…' : 'Load More'}</button>}
    </>}
  </section>
}
