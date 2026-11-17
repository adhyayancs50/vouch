(() => {
  const form = document.getElementById("join-form");
  const fields = document.getElementById("join-fields");
  const codeInput = document.getElementById("join-code");
  const nameInput = document.getElementById("candidate-name");
  const joinButton = document.getElementById("join-session");
  const message = document.getElementById("join-status");
  const retryMessage = document.getElementById("join-retry");
  const storageWarning = document.getElementById("join-storage-warning");
  const details = document.getElementById("joined-interview");
  const clearButton = document.getElementById("clear-joined-interview");
  const policyLabels = {
    PROHIBITED: "AI use prohibited",
    PARTIALLY_ALLOWED: "AI use partially allowed",
    ALLOWED: "AI use allowed",
  };
  let ready = false;
  let busy = false;
  let joinedInterview = null;
  let retryAt = 0;
  let retryTimer;

  function showMessage(text, state = "info") {
    message.textContent = text;
    message.dataset.state = state;
  }

  function warnAboutStorage(text = "") {
    storageWarning.textContent = text;
    storageWarning.hidden = !text;
  }

  function updateControls() {
    form.hidden = Boolean(joinedInterview);
    details.hidden = !joinedInterview;
    fields.disabled = !ready || busy || Boolean(joinedInterview);
    joinButton.disabled = fields.disabled || Date.now() < retryAt;
    joinButton.textContent = busy ? "Joining…" : "Join Session";
    form.setAttribute("aria-busy", String(busy));
    clearButton.disabled = !ready || busy;
  }

  function validInterview(value) {
    const text = item => typeof item === "string" && item.trim().length > 0;
    const domains = items => Array.isArray(items) && items.every(text);
    return value?.success === true && value.status === "JOINED" &&
      text(value.session_id) && text(value.candidate_id) && text(value.title) &&
      text(value.joined_at) && Number.isFinite(Date.parse(value.joined_at)) &&
      (value.candidate_name == null || text(value.candidate_name)) &&
      Object.hasOwn(policyLabels, value.policy?.ai_usage) &&
      domains(value.policy.allowed_domains) && domains(value.policy.restricted_domains);
  }

  function renderInterview() {
    document.getElementById("interview-title").textContent = joinedInterview.title;
    document.getElementById("interview-candidate").textContent = joinedInterview.candidate_name || "";
    document.getElementById("interview-candidate-row").hidden = !joinedInterview.candidate_name;
    document.getElementById("interview-policy").textContent = policyLabels[joinedInterview.policy.ai_usage];
    for (const [id, domains] of [
      ["interview-allowed-domains", joinedInterview.policy.allowed_domains],
      ["interview-restricted-domains", joinedInterview.policy.restricted_domains],
    ]) {
      const list = document.getElementById(id);
      list.replaceChildren();
      for (const domain of domains.length ? domains : ["None specified"]) {
        const item = document.createElement("li");
        item.textContent = domain;
        list.append(item);
      }
    }
  }

  function updateRetryCountdown() {
    clearTimeout(retryTimer);
    const remaining = retryAt - Date.now();
    retryMessage.hidden = remaining <= 0;
    if (remaining > 0) {
      retryMessage.textContent = `Try again in ${Math.ceil(remaining / 1000)} seconds.`;
      retryTimer = setTimeout(updateRetryCountdown, Math.min(1000, remaining));
    } else if (retryAt) {
      retryAt = 0;
      retryMessage.textContent = "";
      if (!joinedInterview) showMessage("You can try joining again.");
      chrome.storage.local.remove("joinRetryAfter").catch(() => {});
    }
    updateControls();
  }

  async function applyRateLimit(response) {
    const header = response.headers.get("Retry-After");
    const now = Date.now();
    const seconds = header?.trim();
    const deadline = seconds && /^\d+$/.test(seconds)
      ? now + Number(seconds) * 1000
      : Date.parse(header);
    // A missing/invalid header gets a conservative one-minute UI cooldown.
    retryAt = Number.isFinite(deadline) ? Math.max(now, deadline) : now + 60000;
    showMessage("Too many join attempts. Please wait before trying again.", "error");
    updateRetryCountdown();
    try {
      await chrome.storage.local.set({ joinRetryAfter: retryAt });
    } catch {
      warnAboutStorage("The wait time could not be saved. Keep this popup open until the countdown ends; reopening does not bypass the backend’s limit.");
    }
  }

  async function showBackendError(response, body) {
    const code = body?.error?.code;
    if (code === "TOO_MANY_ATTEMPTS" || response.status === 429) {
      await applyRateLimit(response);
      return;
    }
    const errors = {
      INVALID_JOIN_CODE: "Invalid join code. Check the code from your employer and try again.",
      SESSION_ALREADY_JOINED: "This code has already been used. Ask the employer for a new session.",
      JOIN_CODE_EXPIRED: "This join code has expired. Ask the employer for a new session.",
      VALIDATION_ERROR: "Please check the join code and optional name (up to 120 characters), then try again.",
      FORBIDDEN: "The development backend accepts only local requests. Run Chrome and the backend on the same computer using 127.0.0.1.",
      NOT_FOUND: "The interview session API is unavailable. Check that session endpoints are enabled on the local development backend.",
    };
    const fallbackCodes = { 401: "INVALID_JOIN_CODE", 409: "SESSION_ALREADY_JOINED", 410: "JOIN_CODE_EXPIRED", 422: "VALIDATION_ERROR", 403: "FORBIDDEN", 404: "NOT_FOUND" };
    const explanation = typeof code === "string" && Object.hasOwn(errors, code)
      ? errors[code] : errors[fallbackCodes[response.status]];
    showMessage(explanation || "The backend could not complete the request. It may have received the join; ask the employer to confirm before using the code again.", "error");
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!ready || busy || joinedInterview || Date.now() < retryAt) return;
    const joinCode = codeInput.value.trim();
    const candidateName = nameInput.value.trim();
    codeInput.removeAttribute("aria-invalid");
    if (!joinCode) {
      codeInput.setAttribute("aria-invalid", "true");
      showMessage("Enter the interview join code from your employer.", "error");
      codeInput.focus();
      return;
    }
    if (candidateName.length > 120) {
      showMessage("Please use a candidate name of 120 characters or fewer.", "error");
      nameInput.focus();
      return;
    }

    busy = true;
    updateControls();
    showMessage("Joining your interview…");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VOUCH_BACKEND.timeoutMs);
    let requestStarted = false;
    try {
      const base = new URL(VOUCH_BACKEND.baseUrl);
      if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || base.username ||
          base.password || base.pathname !== "/" || base.search || base.hash) {
        showMessage("Check the configured local backend URL; use an HTTP address on 127.0.0.1.", "error");
        return;
      }
      requestStarted = true;
      const response = await fetch(new URL("/api/sessions/join", base), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
        body: JSON.stringify({ join_code: joinCode, ...(candidateName ? { candidate_name: candidateName } : {}) }),
      });
      const raw = await response.text();
      let body;
      try { body = JSON.parse(raw); } catch { /* Never display raw backend output. */ }
      if (!response.ok) {
        await showBackendError(response, body);
        return;
      }
      if (response.status !== 200 || !validInterview(body)) {
        codeInput.value = "";
        showMessage("The backend did not return complete join details. The code may already be used; ask the employer to confirm before trying again.", "error");
        return;
      }

      // Save only confirmed, allowlisted fields. Never save the code or invent a token.
      joinedInterview = {
        success: true,
        session_id: body.session_id,
        candidate_id: body.candidate_id,
        title: body.title,
        status: body.status,
        candidate_name: body.candidate_name ?? null,
        joined_at: body.joined_at,
        policy: {
          ai_usage: body.policy.ai_usage,
          allowed_domains: [...body.policy.allowed_domains],
          restricted_domains: [...body.policy.restricted_domains],
        },
      };
      codeInput.value = "";
      nameInput.value = "";
      renderInterview();
      showMessage("Interview joined successfully. Joining has not started monitoring.");
      updateControls();
      try {
        await chrome.storage.local.set({ joinedInterview });
        warnAboutStorage();
      } catch {
        warnAboutStorage("You joined, but these details could not be saved. They will be lost when this popup closes. Do not reuse the code; ask the employer for help if needed.");
      }
    } catch (error) {
      if (requestStarted) codeInput.value = "";
      showMessage(error.name === "AbortError"
        ? "The join request timed out. It may have reached the backend; ask the employer to confirm before using the code again."
        : "Cannot connect to the local backend. Check that it is running at the configured address. If the request reached it, the code may already be used; ask the employer to confirm.", "error");
    } finally {
      clearTimeout(timeout);
      busy = false;
      updateControls();
    }
  });

  clearButton.addEventListener("click", async () => {
    if (!ready || busy || !joinedInterview) return;
    busy = true;
    updateControls();
    try {
      await chrome.storage.local.remove("joinedInterview");
      joinedInterview = null;
      warnAboutStorage();
      showMessage("Saved interview cleared. Use a new, unused code to join another interview.");
    } catch {
      showMessage("Could not clear the saved interview details. Please try again.", "error");
    } finally {
      busy = false;
      updateControls();
      if (!joinedInterview) codeInput.focus();
    }
  });

  async function initialize() {
    try {
      const saved = await chrome.storage.local.get(["joinedInterview", "joinRetryAfter"]);
      if (validInterview(saved.joinedInterview)) {
        joinedInterview = saved.joinedInterview;
        renderInterview();
        showMessage("Showing your saved join confirmation. Monitoring has not been started by joining.");
      } else {
        showMessage("Enter your interview join code to see the details and AI-use policy.");
        if (saved.joinedInterview) warnAboutStorage("Saved interview details could not be read. If you already joined, do not reuse its single-use code; ask the employer for help.");
      }
      if (typeof saved.joinRetryAfter === "number" && Number.isFinite(saved.joinRetryAfter)) {
        retryAt = saved.joinRetryAfter;
      }
    } catch {
      showMessage("Enter an unused interview join code.");
      warnAboutStorage("Saved details could not be loaded. If you already joined an interview, do not reuse its single-use code. New join details may last only while this popup stays open.");
    } finally {
      ready = true;
      updateRetryCountdown();
    }
  }

  initialize();
})();
