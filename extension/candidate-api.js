// Only the service worker calls authenticated candidate endpoints.
class CandidateRequestError extends Error {
  constructor(status, code, retryAfter = 0, invalidEvents = []) {
    super("Candidate request failed");
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.invalidEvents = invalidEvents;
  }
}

async function candidateRequest(credential, route, method = "GET", body) {
  if (!(Date.parse(credential.candidate_token_expires_at) > Date.now())) {
    throw new CandidateRequestError(401, "CANDIDATE_TOKEN_EXPIRED");
  }
  const base = new URL(VOUCH_BACKEND.baseUrl);
  if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" ||
      base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new CandidateRequestError(0, "CONFIGURATION");
  }
  const id = encodeURIComponent(credential.session_id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOUCH_BACKEND.timeoutMs);
  try {
    const response = await fetch(new URL(`/api/sessions/${id}/${route}`, base), {
      method,
      headers: {
        Authorization: `Bearer ${credential.candidate_token}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      credentials: "omit", redirect: "error", cache: "no-store",
      signal: controller.signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => null);
    if (response.status !== 200) {
      const seconds = Number(response.headers.get("Retry-After"));
      const details = data?.error?.details;
      const invalidEvents = [];
      if (response.status === 422 && Array.isArray(details)) {
        for (const detail of details) {
          const match = /^body\.events\.(\d+)(?:\.|$)/.exec(detail?.location);
          if (match) invalidEvents.push(Number(match[1]));
        }
      }
      throw new CandidateRequestError(response.status, data?.error?.code,
        Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0, invalidEvents);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// Copy exactly the documented state. Never pass arbitrary response fields to the popup or disk.
function readCandidateState(data, credential) {
  const consent = data?.consent;
  const monitoring = data?.monitoring;
  const policy = data?.policy;
  const domains = values => Array.isArray(values) && values.every(value => typeof value === "string");
  if (data?.session_id !== credential.session_id || data?.candidate_id !== credential.candidate_id ||
      typeof data.title !== "string" || !["ALLOWED", "PROHIBITED", "PARTIALLY_ALLOWED"].includes(policy?.ai_usage) ||
      !domains(policy.allowed_domains) || !domains(policy.restricted_domains) ||
      !["NONE", "DECLINED", "GRANTED", "WITHDRAWN"].includes(consent?.status) ||
      typeof consent.required_version !== "string" || !consent.required_version ||
      !["NOT_STARTED", "ACTIVE", "STOPPED"].includes(monitoring?.status) ||
      !Number.isFinite(Date.parse(data.candidate_token_expires_at))) {
    throw new CandidateRequestError(0, "INVALID_RESPONSE");
  }
  return {
    session_id: data.session_id, candidate_id: data.candidate_id, title: data.title,
    policy: { ai_usage: policy.ai_usage, allowed_domains: policy.allowed_domains, restricted_domains: policy.restricted_domains },
    consent: { status: consent.status, required_version: consent.required_version,
      consent_version: consent.consent_version, updated_at: consent.updated_at },
    monitoring: { status: monitoring.status, started_at: monitoring.started_at,
      stopped_at: monitoring.stopped_at, stop_reason: monitoring.stop_reason, events_received: monitoring.events_received },
    candidate_token_expires_at: data.candidate_token_expires_at,
  };
}
