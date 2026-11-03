VOUCH — API and Database Documentation
PART A — API DOCUMENTATION
1. Purpose
This document defines how the Vouch frontend, backend, and Chrome extension communicate.
It establishes:
API endpoints.
HTTP request methods.
Required request information.
Expected responses.
Error handling.
Database structure.
Data relationships.
Activity event formats.
Session report formats.
All components must follow these definitions to ensure compatibility.
2. API Architecture
Vouch will use a REST API.
A REST API allows different components to communicate by sending HTTP requests to a server.
For example:
The dashboard sends a request to create an interview session.
The backend processes the request and saves the session.
The backend returns the session information.
The dashboard displays the result.
The Chrome extension uses the same approach to submit activity records.
Initial backend address
During local development:
http://127.0.0.1:8000
All API endpoints will use the following prefix:
/api
For production, the backend address will be replaced with the deployed server's HTTPS address.
3. API Communication Rules
All components must follow these rules:
Requests and responses use JSON unless otherwise specified.
Every interview session has a unique session ID.
Every activity event must reference an existing session.
All timestamps must use UTC in ISO 8601 format.
The backend is responsible for validating and storing submitted information.
The frontend and extension must not directly modify the database.
API responses must follow consistent structures.
Sensitive access tokens must never be exposed in URLs or logged unnecessarily.
Example timestamp:
2026-11-03T20:30:00Z
The Z indicates that the timestamp is in UTC.

(DONT read whats below, thats just for helping train your AI)


4. Session Management APIs
API 4.1 — Create Interview Session
Method: POST
Endpoint:
/api/sessions
Used by: Employer Dashboard
Purpose
Creates a new interview session.
Request Body
{
  "title": "Software Engineering Interview",
  "candidate_name": "John Doe",
  "candidate_email": "john@example.com",
  "policy": {
    "ai_usage": "PROHIBITED",
    "allowed_domains": [],
    "restricted_domains": [
      "chatgpt.com",
      "claude.ai"
    ]
  }
}
The candidate email is optional in the initial MVP.
Expected Backend Behavior
Validate the submitted information.
Generate a unique session ID.
Generate a secure candidate access credential.
Store the session and its policy.
Set the session status to CREATED.
Return the session details and candidate joining information.
Successful Response — 201 Created
{
  "session_id": "sess_8f42a1",
  "title": "Software Engineering Interview",
  "candidate_name": "John Doe",
  "status": "CREATED",
  "candidate_join_code": "EXAMPLE-CODE",
  "created_at": "2026-11-03T20:00:00Z"
}
The actual candidate access credential must be generated securely and must not use the illustrative value above.

API 4.2 — Retrieve Session Details
Method: GET
Endpoint:
/api/sessions/{session_id}
Used by: Employer Dashboard
Purpose
Retrieves information about an existing interview session.
Example Request
GET /api/sessions/sess_8f42a1
Successful Response — 200 OK
{
  "session_id": "sess_8f42a1",
  "title": "Software Engineering Interview",
  "candidate_name": "John Doe",
  "status": "ACTIVE",
  "policy": {
    "ai_usage": "PROHIBITED",
    "allowed_domains": [],
    "restricted_domains": [
      "chatgpt.com",
      "claude.ai"
    ]
  },
  "created_at": "2026-11-03T20:00:00Z",
  "started_at": "2026-11-03T20:15:00Z",
  "completed_at": null
}
Access must be restricted to the employer who owns the session.

API 4.3 — Candidate Joins Session
Method: POST
Endpoint:
/api/sessions/join
Used by: Chrome Extension
Purpose
Allows a candidate to join an employer-created interview session.
Request Body
{
  "join_code": "EXAMPLE-CODE"
}
Expected Backend Behavior
Validate the candidate's joining credential.
Confirm the session exists.
Confirm the session can still be joined.
Return the session's monitoring policy.
Provide a temporary candidate access token.
Successful Response — 200 OK
{
  "session_id": "sess_8f42a1",
  "status": "CREATED",
  "policy": {
    "ai_usage": "PROHIBITED",
    "allowed_domains": [],
    "restricted_domains": [
      "chatgpt.com",
      "claude.ai"
    ]
  },
  "candidate_token": "EXAMPLE-SECURE-TOKEN"
}
The token is illustrative. In the actual implementation, it must be generated securely, have a defined expiration, and be scoped to the relevant session.
The candidate token must be stored securely and never placed in a URL.

API 4.4 — Start Interview Session
Method: POST
Endpoint:
/api/sessions/{session_id}/start
Used by: Chrome Extension
Purpose
Marks the interview session as active after the candidate has reviewed and accepted the monitoring policy.
Request Body
{
  "consent_given": true,
  "consent_version": "1.0"
}
The request must include the candidate access token in its authorization header.
Expected Backend Behavior
Verify the candidate's session access.
Confirm the session is eligible to start.
Record the consent version and timestamp.
Record the server-side session start time.
Change the status to ACTIVE.
Successful Response — 200 OK
{
  "session_id": "sess_8f42a1",
  "status": "ACTIVE",
  "started_at": "2026-11-03T20:15:00Z"
}
The extension must not start tracking before successful session activation.

API 4.5 — End Interview Session
Method: POST
Endpoint:
/api/sessions/{session_id}/complete
Used by: Chrome Extension
Purpose
Marks an interview session as completed.
Expected Backend Behavior
Verify the candidate's session access.
Confirm that the session is active.
Record the completion time.
Change the session status to COMPLETED.
Stop accepting new activity events for that session.
Generate the session report.
Successful Response — 200 OK
{
  "session_id": "sess_8f42a1",
  "status": "COMPLETED",
  "completed_at": "2026-11-03T21:15:00Z",
  "report_status": "GENERATED"
}
If report generation fails, the session must remain completed and the report must be marked as pending or failed. The system must not pretend that a report was generated.

5. Browser Activity APIs
API 5.1 — Submit Activity Event
Method: POST
Endpoint:
/api/sessions/{session_id}/events
Used by: Chrome Extension
Purpose
Sends a recorded browser activity event to the backend.
Request Body
{
  "event_id": "evt_001",
  "event_type": "TAB_SWITCH",
  "timestamp": "2026-11-03T20:30:00Z",
  "metadata": {
    "active_tab_id": 12,
    "previous_tab_id": 8
  }
}
Supported Event Types
Event type
Meaning
TAB_SWITCH
Candidate switches between browser tabs.
TAB_CREATED
A new browser tab is opened.
TAB_CLOSED
An existing browser tab is closed.
WEBSITE_NAVIGATION
Candidate navigates to a different website.
INTERVIEW_TAB_INACTIVE
The designated interview tab loses focus.

Expected Backend Behavior
Authenticate the candidate token.
Verify that the session is active.
Validate the event type and required fields.
Validate the timestamp.
Check whether the event has already been submitted.
Store the event.
Return confirmation.
Successful Response — 201 Created
{
  "success": true,
  "event_id": "evt_001",
  "session_id": "sess_8f42a1",
  "message": "Activity event stored successfully."
}
Duplicate Event Response
If an event with the same ID has already been received, the backend should not create another copy.
It should return the existing event's acknowledgement.
This prevents duplicate records when the extension retries a failed request.

API 5.2 — Retrieve Session Activity
Method: GET
Endpoint:
/api/sessions/{session_id}/events
Used by: Employer Dashboard
Purpose
Retrieves all recorded activity events associated with a session.
Successful Response — 200 OK
{
  "session_id": "sess_8f42a1",
  "total_events": 2,
  "events": [
    {
      "event_id": "evt_001",
      "event_type": "TAB_SWITCH",
      "timestamp": "2026-11-03T20:30:00Z",
      "metadata": {
        "active_tab_id": 12,
        "previous_tab_id": 8
      }
    },
    {
      "event_id": "evt_002",
      "event_type": "WEBSITE_NAVIGATION",
      "timestamp": "2026-11-03T20:31:00Z",
      "metadata": {
        "domain": "example.com"
      }
    }
  ]
}
Events must be returned in chronological order.
Access must be restricted to the employer who owns the session.

6. Session Report APIs
API 6.1 — Retrieve Session Report
Method: GET
Endpoint:
/api/sessions/{session_id}/report
Used by: Employer Dashboard
Purpose
Retrieves the finalized session report.
Successful Response — 200 OK
{
  "report_id": "report_001",
  "session_id": "sess_8f42a1",
  "status": "GENERATED",
  "session_summary": {
    "started_at": "2026-11-03T20:15:00Z",
    "completed_at": "2026-11-03T21:15:00Z",
    "total_events": 24,
    "tracking_interruptions": 0
  },
  "policy": {
    "ai_usage": "PROHIBITED"
  },
  "integrity": {
    "algorithm": "SHA-256",
    "verification_status": "NOT_CHECKED"
  }
}
The report should also provide access to its detailed chronological event records.
A report must clearly distinguish observed activity from policy conclusions.

API 6.2 — Verify Session Report
Method: GET
Endpoint:
/api/sessions/{session_id}/verify
Used by: Employer Dashboard
Purpose
Checks whether the finalized report matches the contents used to generate its original integrity fingerprint.
Expected Backend Behavior
Retrieve the finalized report.
Recalculate its SHA-256 hash using the agreed report format.
Compare it with the originally stored hash.
Return the verification result.
Successful Response — 200 OK
{
  "session_id": "sess_8f42a1",
  "verified": true,
  "algorithm": "SHA-256",
  "message": "Report contents match the original integrity fingerprint."
}
If the hashes differ:
{
  "session_id": "sess_8f42a1",
  "verified": false,
  "algorithm": "SHA-256",
  "message": "Report integrity check failed."
}
A successful hash comparison establishes that the checked contents match the stored fingerprint. It does not establish that the original activity records were complete or accurate.

7. Common API Error Responses
All API errors should follow a consistent format.
Example:
{
  "error": {
    "code": "INVALID_SESSION",
    "message": "The requested interview session does not exist."
  }
}
Expected HTTP Status Codes
Status code
Meaning
200
Request completed successfully.
201
New resource created successfully.
400
Invalid request information.
401
Missing or invalid authentication.
403
User is not authorized to access the resource.
404
Requested resource does not exist.
409
Request conflicts with the current session state.
422
Request failed validation.
500
Unexpected server error.
503
Backend temporarily unavailable.

The backend should return useful error messages without exposing passwords, tokens, secret keys, or internal system details.

PART B — DATABASE DOCUMENTATION
8. Database Overview
Vouch will initially use SQLite.
SQLite is a lightweight database that stores information in a local database file. It is suitable for developing and testing our initial MVP without setting up a separate database server.
The backend will communicate with the database using SQLAlchemy.
The initial database will contain five primary tables:
Employers
Sessions
Activity Events
Session Reports
Session Consents
9. Database Relationships
The database will follow this relationship structure:
EMPLOYERS
    |
    | One employer can create multiple sessions
    |
    v
SESSIONS
    |
    | One session can contain multiple events
    |
    +--------------------+
    |                    |
    v                    v
ACTIVITY_EVENTS     SESSION_REPORTS
                         |
                         |
                    One report per
                    finalized session

SESSIONS
    |
    | One session can have one consent record
    |
    v
SESSION_CONSENTS
The employer ID links a session to its owner.
The session ID connects the activity events, consent record, and report to the relevant interview.

10. Table 1 — Employers
Purpose
Stores employer account information.
Fields
Field
Data type
Description
id
Integer
Unique employer identifier.
name
String
Employer's name or organization name.
email
String
Employer's email address.
password_hash
String
Securely hashed password, never the original password.
created_at
DateTime
Account creation time.

Example
{
  "id": 1,
  "name": "Example Company",
  "email": "hr@example.com",
  "created_at": "2026-11-03T19:00:00Z"
}
Passwords must be hashed using a suitable password-hashing algorithm before storage.

11. Table 2 — Sessions
Purpose
Stores information about each interview session.
Fields
Field
Data type
Description
id
String
Unique session identifier.
employer_id
Integer
Employer who created the session.
title
String
Interview title.
candidate_name
String
Candidate's name or identifier.
candidate_email
String
Candidate's email, optional.
join_code_hash
String
Secure hash of the candidate's joining code.
ai_usage
String
Selected AI-use policy.
allowed_domains
JSON
List of permitted domains.
restricted_domains
JSON
List of restricted domains.
status
String
Current session status.
created_at
DateTime
Session creation time.
started_at
DateTime
Interview start time.
completed_at
DateTime
Interview completion time.

Session Status Values
Status
Meaning
CREATED
Session created but not started.
ACTIVE
Candidate has started the session.
COMPLETED
Candidate has completed the session.
INTERRUPTED
Session ended unexpectedly or tracking was interrupted.
EXPIRED
Session is no longer available for joining.

An interrupted session must not automatically be treated as completed.
AI Usage Policy Values
Value
Meaning
PROHIBITED
AI assistance is not permitted.
PARTIALLY_ALLOWED
Only specified AI assistance is permitted.
ALLOWED
AI assistance is permitted.

The policy should also retain its detailed configuration, including any permitted or restricted domains.

12. Table 3 — Activity Events
Purpose
Stores individual browser activity records submitted by the Chrome extension.
Fields
Field
Data type
Description
id
Integer
Internal database identifier.
event_id
String
Unique event identifier generated by the extension.
session_id
String
Associated interview session.
event_type
String
Type of browser activity.
timestamp
DateTime
Time the browser event occurred.
received_at
DateTime
Time the backend received the event.
metadata
JSON
Additional information about the event.

Example
{
  "event_id": "evt_001",
  "session_id": "sess_8f42a1",
  "event_type": "TAB_SWITCH",
  "timestamp": "2026-11-03T20:30:00Z",
  "received_at": "2026-11-03T20:30:01Z",
  "metadata": {
    "active_tab_id": 12,
    "previous_tab_id": 8
  }
}
Important Rules
Every event must belong to an existing session.
Event IDs must be unique within the database.
Duplicate event submissions must not create duplicate records.
Events should be retrieved in chronological order.
Original event timestamps must be preserved.
Received timestamps should be stored separately.
Activity records should not be silently overwritten.
Only the minimum necessary metadata should be stored.

13. Table 4 — Session Reports
Purpose
Stores finalized interview reports and their integrity information.
Fields
Field
Data type
Description
id
Integer
Internal report identifier.
report_id
String
Unique report identifier.
session_id
String
Associated interview session.
report_data
JSON
Finalized report contents or structured summary.
report_hash
String
SHA-256 fingerprint of the finalized report.
hash_algorithm
String
Hashing algorithm used.
generated_at
DateTime
Report generation time.
verification_status
String
Latest verification result.

Example
{
  "report_id": "report_001",
  "session_id": "sess_8f42a1",
  "hash_algorithm": "SHA-256",
  "report_hash": "EXAMPLE_HASH_VALUE",
  "verification_status": "NOT_CHECKED",
  "generated_at": "2026-11-03T21:15:00Z"
}
Report Integrity Rules
The backend must generate the report from the session information and stored activity records.
Before calculating the hash, the report must be converted into a consistent JSON representation so that the same report produces the same hash.
The report should then be finalized and stored.
If the report is changed, its newly calculated hash should differ from the original.
The initial SHA-256 implementation is designed to detect accidental or unauthorized content changes when the original fingerprint remains trustworthy.
It does not protect against an attacker who can modify both the report and its stored hash. Stronger protection using digital signatures and separately protected signing keys should be considered in a later security milestone.

14. Table 5 — Session Consents
Purpose
Stores the candidate's acceptance of the monitoring policy before a session begins.
Fields
Field
Data type
Description
id
Integer
Internal consent identifier.
session_id
String
Associated interview session.
consent_given
Boolean
Whether the candidate accepted.
consent_version
String
Version of the monitoring policy presented.
consented_at
DateTime
Time consent was recorded.

Example
{
  "session_id": "sess_8f42a1",
  "consent_given": true,
  "consent_version": "1.0",
  "consented_at": "2026-11-03T20:14:00Z"
}
The backend must not activate a session without a valid consent record.
Declining consent must not start activity tracking.

PART C — DATA HANDLING RULES
15. Timestamp Management
All timestamps must be stored in UTC.
The system should distinguish between:
Event timestamp: When the browser event occurred.
Received timestamp: When the backend received the event.
Session start time: When the interview started.
Session completion time: When the interview ended.
Report generation time: When the report was finalized.
This distinction is important because network interruptions may cause events to reach the backend later than they occurred.
16. Event Validation
Before storing an activity event, the backend must verify:
The session exists.
The candidate has valid access.
The session is active.
The event ID is present.
The event type is supported.
The timestamp is valid.
The metadata follows the expected structure.
Invalid events should be rejected with a useful error response.
17. Data Access and Security
The following access rules must apply:
Employers can access only sessions they own.
Candidates can submit events only to their authorized session.
Candidate tokens must not grant access to employer dashboards.
Passwords must never be stored in plain text.
Candidate joining codes should be stored as secure hashes.
API credentials must not be included in public source code.
The database should not be directly accessible from the frontend or extension.
18. Report Generation Process
When a session is completed:
Backend retrieves the session information.
Backend retrieves all stored activity events.
Events are sorted chronologically.
The report is assembled.
The report is converted into a consistent JSON representation.
SHA-256 is calculated from that representation.
The report and its hash are stored.
The report becomes available to the employer dashboard.
The report should preserve information about missing events, tracking interruptions, and incomplete sessions.
19. Data Retention
The initial MVP should retain only information necessary for the interview verification process.
A future retention policy should define:
How long session records are stored.
How long activity records are retained.
When reports are deleted.
How employers request deletion.
How candidates are informed about retention.
Retention periods must be defined before the product is used with real interview candidates.

PART D — DEVELOPMENT CONTRACTS
20. Responsibilities by Component
Team member
Main responsibility
Relevant API/database work
Adhyayan
Architecture and integration
Maintain consistency across all API contracts.
Justin
Chrome extension
Session joining, session start/end, event submission.
Srihith
Backend
Implement API endpoints, database tables, event processing, and report generation.
Ada
Employer dashboard
Session creation, session retrieval, event display, and report viewing.
Javier
Security and verification
Review access controls, event validation, report integrity, and verification behavior.

21. API Contract Rules
The following rules must be followed throughout development:
Do not independently rename API endpoints.
Do not change event types without coordinating with the team.
Do not change request or response formats without updating this document.
Use the same session ID across all components.
Use consistent timestamp formats.
Validate all incoming information on the backend.
Document any new API endpoint before implementing it across components.
Test communication between components after integration.
22. MVP API Completion Criteria
The API and database implementation is complete when:
An employer can create an interview session.
A candidate can join using valid access credentials.
The candidate can start and complete the session.
The extension can submit browser activity events.
The backend can validate and store those events.
The dashboard can retrieve session information.
The dashboard can retrieve recorded events.
A finalized report can be generated.
The report's integrity can be checked.
Unauthorized access is rejected.
The goal is to establish a consistent communication system that allows the Chrome extension, backend, and employer dashboard to operate as one application.

