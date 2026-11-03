VOUCH — System Architecture
1. Architecture Overview
Vouch follows a three-component architecture consisting of:
Candidate Chrome Extension
Backend Server and Database
Employer Web Dashboard
Each component has a specific responsibility and communicates with the others through defined API endpoints.
The backend serves as the central communication point between the Chrome extension and the employer dashboard.
High-Level Architecture
             EMPLOYER
                 |
                 v
       +--------------------+
       | Employer Dashboard |
       | React + TypeScript |
       +--------------------+
                 |
                 | API Requests
                 v
       +--------------------+
       |   Backend Server   |
       |   Python / FastAPI |
       +--------------------+
                 |
                 v
       +--------------------+
       |      Database      |
       |       SQLite       |
       +--------------------+
                 ^
                 |
                 | Activity Events
                 |
       +--------------------+
       |  Chrome Extension  |
       | JavaScript / MV3   |
       +--------------------+
                 ^
                 |
                 |
             CANDIDATE
The dashboard and Chrome extension do not communicate directly. All session information and activity records pass through the backend.

2. Component 1 — Candidate Chrome Extension
Purpose
The Chrome extension is responsible for collecting selected browser activity during an active interview session.
It provides the candidate with an interface to join, start, and end a Vouch session.
Core Responsibilities
A. Session Management
Allow candidates to enter or open an interview session.
Retrieve the session's monitoring policy from the backend.
Display the monitoring requirements before tracking begins.
Start and stop activity tracking based on candidate consent and session state.
B. Browser Activity Tracking
The extension will use Chrome's Extension APIs to observe selected browser events.
Initial events include:
Event
Description
Tab activated
Records when the candidate switches to another browser tab.
Tab created
Records when a new browser tab is opened.
Tab removed
Records when a browser tab is closed.
Website navigation
Records navigation to a different website or URL, subject to the agreed privacy policy.
Interview tab inactive
Records when the candidate leaves the designated interview tab.

Relevant Chrome APIs include:
chrome.tabs.onActivated
chrome.tabs.onCreated
chrome.tabs.onRemoved
chrome.webNavigation
chrome.storage
The extension should collect only the information necessary for the verification process.
C. Activity Event Format
Every recorded event should follow a consistent structure.
Example:
{
  "session_id": "session_123",
  "event_type": "TAB_SWITCH",
  "timestamp": "2026-11-03T19:30:00Z",
  "metadata": {
    "active_tab_id": 12,
    "previous_tab_id": 8
  }
}
The exact fields may evolve during implementation, but all components must follow the same agreed format.
D. Sending Events to the Backend
The extension will send recorded events to the backend using HTTP API requests.
Each event must be associated with the correct interview session.
If the network becomes temporarily unavailable, the extension may queue events locally and attempt to send them again when connectivity returns.
E. Privacy Restrictions
The initial extension will NOT:
Capture keystrokes.
Record the candidate's screen.
Read the contents of arbitrary webpages.
Access unrelated personal files.
Claim to monitor activity outside the supported browser environment.
The extension must clearly communicate its monitoring scope to the candidate.

3. Component 2 — Backend Server and Database
Purpose
The backend is the central system responsible for managing interview sessions, receiving browser activity, storing information, and generating session reports.
Technology
Python
FastAPI
SQLite
Core Responsibilities
A. Interview Session Management
The backend must support:
Creating interview sessions.
Generating unique session identifiers.
Storing employer-defined AI-use policies.
Retrieving session information.
Tracking session status (created, active, completed).
B. Activity Event Processing
When the Chrome extension sends an event, the backend must:
Receive the event through an API endpoint.
Validate that the event contains the required information.
Confirm that the associated session exists.
Check that the session is active.
Store the event in the database.
Return a success or error response.
C. Database Management
The initial database should contain the following logical tables:
Table
Purpose
Employers
Stores employer account information.
Sessions
Stores interview session details and policies.
Activity Events
Stores browser activity recorded during sessions.
Session Reports
Stores generated session reports and their verification information.

The exact database schema will be finalized in Document 05.
D. Session Report Generation
After a session ends, the backend will generate a structured report containing:
Session identification.
Session start and end times.
Configured monitoring policy.
Total recorded events.
Chronological list of recorded activity.
Relevant timestamps.
Any tracking interruptions or missing data.
Report integrity information.
E. Report Verification
The backend will generate a unique digital fingerprint for each finalized report using a secure hashing algorithm.
A hash is a fixed-length value calculated from the report's contents. If the report changes, its calculated hash should also change.
The system will use this to detect modifications to a report after it has been finalized.
The verification process must not be presented as proof that all candidate activity was captured or that the original browser events were truthful.

4. Component 3 — Employer Web Dashboard
Purpose
The dashboard provides employers with an interface to create interviews, configure AI-use policies, and review candidate session reports.
Technology
React
TypeScript
Core Pages
A. Employer Login
Allows employers to access their accounts securely.
B. Dashboard Home
Displays:
Previously created interview sessions.
Active sessions.
Completed sessions.
Access to individual session reports.
C. Create Interview Session
Allows employers to:
Create a new interview session.
Define its AI-use policy.
Configure permitted and restricted resources.
Generate a unique session link or code for the candidate.
D. Session Report
Displays:
Interview session details.
Session duration.
Recorded browser events.
Chronological activity timeline.
Policy information.
Report verification status.
The dashboard should distinguish between observed events and policy violations. A tab switch or website visit alone does not establish that prohibited AI assistance was used.

5. Communication Between Components
All components communicate through the backend using API endpoints.
The backend will expose a REST API, which allows the extension and dashboard to send and retrieve information using standard HTTP requests.
Initial API Structure
Method
Endpoint
Purpose
POST
/api/sessions
Create a new interview session.
GET
/api/sessions/{id}
Retrieve session information.
POST
/api/sessions/{id}/start
Start an interview session.
POST
/api/sessions/{id}/events
Submit recorded browser activity.
POST
/api/sessions/{id}/complete
Complete an interview session.
GET
/api/sessions/{id}/events
Retrieve recorded activity.
GET
/api/sessions/{id}/report
Retrieve the generated session report.
GET
/api/sessions/{id}/verify
Check the report's integrity.

These endpoints are the proposed initial interface. Their request and response formats will be specified in Document 05 before implementation.

6. Complete System Workflow
The following describes how all three components work together.
Stage 1 — Employer Creates a Session
Employer opens the Vouch dashboard.
Employer creates an interview session.
Employer selects an AI-use policy.
Backend generates a unique session ID and stores the session.
Dashboard displays a session link or code.
Stage 2 — Candidate Starts the Interview
Candidate opens the session link or enters the session code.
Chrome extension retrieves the session details.
Extension displays the monitoring policy.
Candidate reviews and accepts the policy.
Extension begins recording permitted browser activity.
Stage 3 — Activity Tracking
Candidate switches browser tabs or navigates between websites.
Chrome extension detects the relevant browser event.
Extension records the event and its timestamp.
Event is sent to the backend.
Backend validates and stores the event.
Stage 4 — Interview Completion
Candidate ends the interview session.
Extension stops collecting activity for that session.
Backend marks the session as completed.
Backend generates a structured session report.
Report contents are hashed and its integrity information is stored.
Stage 5 — Employer Verification
Employer opens the completed session in the dashboard.
Dashboard retrieves the report from the backend.
Employer reviews the recorded browser activity.
Employer can request report verification.
Backend checks whether the report contents still match the stored integrity information.
Dashboard displays the verification result.

7. Security and Data Integrity
Security must be considered throughout development rather than added after the main product is complete.
The initial implementation should include:
Secure communication between components using HTTPS in production.
Validation of all incoming API requests.
Unique identifiers for interview sessions.
Access controls to prevent unauthorized access to session reports.
Restricted browser permissions for the extension.
Protection against unauthorized modification of finalized reports.
Clear handling of interrupted sessions and missing activity records.
The report verification mechanism will initially focus on detecting changes to finalized reports.
A successful integrity check confirms that the report matches the version against which it was verified. It does not prove that the extension captured every relevant event or that the underlying observations were accurate.

8. Error Handling and Reliability
The system must account for situations where components do not work as expected.
Examples include:
Situation
Expected behavior
Backend unavailable
Extension temporarily queues events and retries transmission.
Invalid session ID
Extension displays an appropriate error.
Session already completed
Backend rejects additional activity submissions.
Missing event information
Backend rejects the invalid event.
Candidate closes Chrome
Session is marked as interrupted or incomplete when detected; it must not be treated as a normal completion.
Report integrity check fails
Dashboard displays a verification failure.

The system should never silently discard errors that could affect the reliability of a session report.

9. Development and Integration Strategy
Development will follow a component-based approach.
Each teammate will own a specific component while following the shared architecture.
Team member
Component ownership
Adhyayan
System architecture, integration, documentation, and development coordination.
Justin
Candidate Chrome extension.
Srihith
Backend server and database.
Ada
Employer dashboard and frontend.
Javier
Security, privacy, and report integrity verification.

Integration Order
Establish the project repository and shared development environment.
Create the initial backend and database.
Develop the Chrome extension's activity-tracking functionality.
Connect the extension to the backend.
Develop the employer dashboard.
Connect the dashboard to the backend.
Implement report generation and verification.
Test the complete system.
Components may be developed in parallel once their communication formats have been agreed upon.

10. Architecture Principles
All development decisions should follow these principles:
Simplicity: Prefer straightforward implementations over unnecessary complexity.
Modularity: Each component should have a clearly defined responsibility.
Consistency: All components must use the same agreed data formats and API definitions.
Privacy: Collect only the information necessary for the product's intended purpose.
Reliability: Every feature must be tested before being integrated.
Scalability: Structure the code so additional features can be introduced without rewriting the entire system.
AI-assisted development: AI coding tools must follow this architecture and must not independently introduce conflicting frameworks, libraries, or system designs.
11. Definition of a Successful Architecture
The architecture will be considered successfully implemented when:
The employer can create an interview session.
The candidate can join the session through the Chrome extension.
The extension can record and transmit browser activity.
The backend can receive and store activity records.
The employer dashboard can retrieve and display those records.
A session report can be generated after completion.
The system can detect modifications to the finalized report.
The ultimate goal is a connected, functional system in which all three components work together as one product.

