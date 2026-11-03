VOUCH — Feature Specifications

1. Purpose
This document defines the individual features that make up Vouch.
It explains what each feature does, how users interact with it, what information it requires, and what must work before it can be considered complete.
All development work should follow these specifications. If a feature needs to change, the decision should be discussed with the team and reflected in this document.
2. Product Overview
Vouch is a privacy-first interview verification system that helps employers review observable browser activity during remote interviews.
The product consists of three main components:
Candidate Chrome Extension
Backend Server
Employer Dashboard
The system allows employers to create interview sessions, establish AI-use policies, invite candidates, record permitted browser events, and review a session report.
Vouch does not claim to detect all AI usage or monitor activity outside its supported browser environment.
3. User Roles
A. Employer
The employer uses the Vouch dashboard to:
Create interview sessions.
Define AI-use policies.
Share session access with candidates.
Review completed interview reports.
Check report integrity.
B. Candidate
The candidate uses the Chrome extension to:
Join an interview session.
Review the monitoring policy.
Give consent to the defined monitoring.
Start and end the session.
View information about recorded activity.
C. System
The backend:
Manages sessions.
Receives activity events.
Stores information.
Generates reports.
Checks report integrity.
4. Feature Priority
Features will be divided into three categories.
Priority
Meaning
P0 — Essential
Required for the initial working MVP.
P1 — Important
Should be implemented after the core workflow works.
P2 — Future
Additional functionality that can be introduced later.

The team should complete P0 features before spending time on advanced functionality.

5. Employer Dashboard Features
Feature 5.1 — Employer Account and Access
Priority: P1
Purpose
Allow employers to access their Vouch dashboard and manage their interview sessions.
Expected behavior
Employers can create an account and sign in.
Each employer can access only their own interview sessions.
Employers remain signed in during normal navigation.
Unauthorized users cannot access protected session reports.
Completion criteria
An employer can authenticate successfully.
The dashboard displays the correct employer's sessions.
Unauthorized access to another employer's sessions is prevented.
For the earliest local prototype, a temporary development account may be used. Proper authentication must be implemented before real users or sensitive session information are introduced.
Feature 5.2 — Dashboard Home
Priority: P0
Purpose
Provide employers with an overview of their interview sessions.
Expected behavior
The dashboard should display:
Total sessions created.
Active sessions.
Completed sessions.
Incomplete or interrupted sessions.
A list of recent sessions.
Each session should display:
Session name.
Candidate identifier or assigned candidate name.
Creation date.
Current status.
Option to open session details.
Completion criteria
The dashboard retrieves sessions from the backend.
Session information is displayed correctly.
The employer can open an individual session.
Feature 5.3 — Create Interview Session
Priority: P0
Purpose
Allow employers to create an interview session before inviting a candidate.
Expected behavior
The employer should be able to enter:
Interview title.
Candidate name or identifier.
Interview description (optional).
AI-use policy.
Session duration or scheduled time (optional for MVP).
When submitted:
The dashboard sends the session details to the backend.
The backend validates the information.
A unique session identifier is generated.
A candidate access link or code is generated.
The session is saved.
The dashboard displays confirmation and the candidate access details.
Completion criteria
An employer can create a session.
The session is stored in the database.
The session appears on the dashboard.
The candidate can use the generated access details to join.
Feature 5.4 — AI-Use Policy Configuration
Priority: P0
Purpose
Allow employers to specify which external resources candidates may use during an interview.
Initial policy options
Option A — AI prohibited
The employer does not permit external AI assistance during the interview.
Option B — AI partially permitted
The employer permits certain AI tools or forms of assistance but restricts others.
Option C — AI permitted
The employer permits AI assistance during the interview.
Additional configuration
Employers may specify:
Permitted websites.
Restricted websites.
Additional interview instructions.
Whether external browsing is permitted.
Expected behavior
The policy must be saved with the interview session and displayed to the candidate before tracking begins.
Completion criteria
An employer can select a policy.
Optional website rules can be configured.
The policy is stored with the session.
The candidate can review the policy before providing consent.
Important: A policy setting does not automatically enforce restrictions on every application or device. Website matching and browser restriction features must be implemented separately. The initial MVP records observable activity and allows employers to review it.
Feature 5.5 — Session Details Page
Priority: P0
Purpose
Display information about an individual interview session.
Expected behavior
The page should display:
Session identifier.
Interview title.
Candidate information.
Configured AI-use policy.
Session creation date.
Session status.
Candidate access information.
Link to the session report when available.
Completion criteria
The employer can open a session and retrieve its information from the backend.
Feature 5.6 — Session Report Viewer
Priority: P0
Purpose
Allow employers to review browser activity recorded during an interview.
Report contents
Candidate and session identification.
Session start and end times.
Configured monitoring policy.
Total recorded events.
Chronological activity timeline.
Website domains recorded, where permitted.
Tab-switch events.
Tracking interruptions.
Missing or delayed event information.
Report integrity status.
Expected behavior
Events should be presented in chronological order.
The interface should clearly distinguish:
Normal recorded activity.
Activity that may warrant employer review.
Tracking interruptions.
Information that could not be collected.
A browser event must not automatically be labeled as cheating or prohibited AI use.
Completion criteria
The report is retrieved from the backend.
Events appear in the correct order.
The configured policy is visible.
Verification status is displayed.
Incomplete or interrupted sessions are clearly identified.

6. Candidate Chrome Extension Features
Feature 6.1 — Extension Interface
Priority: P0
Purpose
Provide candidates with a simple interface to access and control Vouch sessions.
Expected behavior
The extension popup should display:
Vouch branding.
Session joining field.
Session status.
Start and end session controls.
Monitoring information.
The interface should be simple and understandable.
Completion criteria
The extension loads successfully in Chrome and displays its interface without errors.
Feature 6.2 — Join Interview Session
Priority: P0
Purpose
Allow candidates to connect the extension to an employer-created session.
Expected behavior
Candidate enters a session code or opens a session link.
Extension sends the access information to the backend.
Backend checks whether the session exists and can still be joined.
Extension retrieves the session details and monitoring policy.
Candidate sees the policy before starting.
Completion criteria
Valid session details can be retrieved.
Invalid or expired session access is rejected.
Candidate sees the correct monitoring policy.
Feature 6.3 — Candidate Consent
Priority: P0
Purpose
Ensure candidates understand the monitoring process before activity collection begins.
Expected behavior
The extension must explain:
Which browser events are recorded.
What information is sent to the backend.
How the information is used.
What the extension cannot monitor.
When tracking begins and ends.
The candidate must explicitly accept the monitoring policy before starting.
Completion criteria
Tracking does not begin before consent.
Consent is associated with the relevant session.
The candidate can decline instead of starting the session.
Feature 6.4 — Start and End Session
Priority: P0
Purpose
Control the period during which browser activity is collected.
Expected behavior
When the candidate starts:
The extension confirms the session is valid.
The backend records the session start time.
The extension begins collecting permitted browser events.
The extension displays an active-session indicator.
When the candidate ends:
The extension stops collecting events for that session.
Pending events are submitted.
The backend records the completion time.
The session is marked completed.
Completion criteria
A candidate can start a valid session.
Events are collected only during the active session.
Ending a session stops collection.
The backend reflects the correct session status.
Feature 6.5 — Browser Activity Tracking
Priority: P0
Purpose
Record selected browser activities during an interview.
Initial events
Event
Information recorded
Tab switch
Time of switch and relevant tab identifiers.
Tab opened
Time a new tab is created.
Tab closed
Time a tab is closed.
Website navigation
Permitted URL or domain information and timestamp.
Interview tab inactive
When the designated interview tab loses focus.

Technical implementation
Use Chrome Extension APIs, including:
chrome.tabs
chrome.webNavigation
chrome.windows
chrome.storage
The exact API permissions must be limited to what the implemented functionality requires.
Completion criteria
Relevant browser events are detected.
Events contain timestamps.
Events are associated with the correct session.
Events are transmitted to the backend.
No unrelated page content or keystrokes are collected.
Feature 6.6 — Activity Transmission and Recovery
Priority: P0
Purpose
Ensure activity records are not silently lost when network connectivity is interrupted.
Expected behavior
Events are temporarily queued when transmission fails.
The extension retries transmission when connectivity returns.
Events are not unnecessarily duplicated.
The system records transmission interruptions where relevant.
Completion criteria
A temporary network interruption does not silently erase already collected events.
Feature 6.7 — Candidate Session Status
Priority: P1
Purpose
Give candidates visibility into their current monitoring status.
Expected behavior
Display:
Current session.
Session start time.
Active or inactive status.
Connection status.
Recorded event count, if useful.
Option to end the session.

7. Backend Features
Feature 7.1 — Session Creation and Management
Priority: P0
The backend must:
Generate unique session IDs.
Store employer and candidate information.
Save the AI-use policy.
Generate candidate access credentials.
Track session status.
Prevent unauthorized session access.
Feature 7.2 — Event Reception
Priority: P0
The backend must:
Receive activity records.
Validate the event structure.
Verify session access.
Confirm the session is active.
Reject malformed or unauthorized submissions.
Store accepted events.
Return an appropriate response.
Feature 7.3 — Activity Event Storage
Priority: P0
Each event must be associated with its interview session.
The backend must support retrieving events in chronological order.
Events should retain their original timestamps and should not be silently overwritten.
Feature 7.4 — Session Completion
Priority: P0
The backend must:
Record session completion time.
Prevent additional events from being accepted after completion.
Handle incomplete or interrupted sessions separately.
Trigger report generation.
Feature 7.5 — Session Report Generation
Priority: P0
The backend must generate a structured report containing:
Session details.
Monitoring policy.
Start and end times.
Recorded events.
Activity summary.
Tracking interruptions.
Data completeness information.
Feature 7.6 — Report Integrity Verification
Priority: P0
The system must generate a SHA-256 hash of the finalized report.
A hash is a fixed-length digital fingerprint calculated from the report's contents.
When verification is requested:
The backend retrieves the finalized report.
It calculates the report's hash again.
It compares the new hash with the previously stored hash.
It returns whether the report contents match.
If the values differ, the dashboard must indicate that the report failed its integrity check.
For stronger protection against an attacker who can modify both the report and its stored hash, a later implementation should use a digital signature whose private signing key is kept separately from the database.

8. Cross-Component Features
Feature 8.1 — Session Synchronization
Priority: P0
All three components must use the same session identifier.
The employer dashboard, Chrome extension, and backend must refer to the same session.
Feature 8.2 — Consistent Event Format
Priority: P0
All activity events must follow the agreed structure defined in Document 05.
Feature 8.3 — Error Handling
Priority: P0
The system must handle:
Invalid session access.
Backend unavailability.
Invalid activity events.
Expired candidate credentials.
Interrupted tracking.
Duplicate event submissions.
Failed report verification.
Errors should be clearly communicated instead of causing silent failures.

9. Development Milestones
The features should be implemented in the following order.
Milestone 1 — Project Foundation
Create the GitHub repository.
Set up the frontend.
Set up the backend.
Establish the database.
Load a basic Chrome extension.
Milestone 2 — First Working Activity Tracker
Build the extension interface.
Implement session activation.
Implement tab-switch tracking.
Implement website navigation tracking.
Test event collection locally.
Milestone 3 — Backend Integration
Implement session creation.
Implement candidate session joining.
Implement activity event submission.
Store events in SQLite.
Retrieve stored events.
Milestone 4 — Employer Dashboard
Build the dashboard home.
Implement session creation.
Add policy configuration.
Display session information.
Display activity timelines.
Milestone 5 — Reports and Verification
Generate session reports.
Calculate report hashes.
Implement report verification.
Display verification results.
Milestone 6 — Final Integration
Connect all components.
Test the complete workflow.
Fix integration errors.
Improve the user interface.
Prepare the MVP for demonstration.

10. MVP Completion Criteria
Vouch's initial MVP is complete when:
An employer can create an interview session.
The employer can define the session's AI-use policy.
A candidate can join the session through the extension.
The candidate can review and accept the monitoring policy.
The extension can record selected browser events.
Events are successfully transmitted to the backend.
The backend stores and organizes the activity records.
A session report is generated after completion.
The employer can review the report.
The system can detect changes to the finalized report.
A successful demonstration must show the complete workflow, from session creation to report verification.
The system must clearly communicate its monitoring limitations and must not claim to prove that no AI was used.

