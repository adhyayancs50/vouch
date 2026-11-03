VOUCH — Project Overview
1. Project Description
Vouch is a privacy-first interview verification system designed to help employers verify whether candidates followed predefined AI-use policies during remote interviews.
As AI tools such as ChatGPT and Claude become increasingly accessible, employers face challenges in determining whether candidates are independently completing assessments or relying on prohibited external assistance.
Traditional monitoring solutions can be invasive, often requiring extensive access to a candidate's screen, applications, or personal device activity.
Vouch aims to address this problem by providing a less intrusive alternative: recording specific, observable browser activities during an interview and generating a verifiable session report that employers can review.
2. Problem Statement
Remote interviews create an accountability gap between candidates and employers.
Employers may establish rules regarding the use of AI tools, external websites, and other resources during assessments. However, they have limited visibility into whether these rules are being followed.
Existing monitoring approaches can compromise candidate privacy, while less invasive approaches may not provide sufficient evidence of browser activity.
Vouch aims to balance these competing requirements through limited, transparent, and consent-based activity tracking.
3. Proposed Solution
Vouch consists of three primary components:
A. Candidate Chrome Extension
A browser extension that candidates activate before beginning an interview.
Its responsibilities include:
Starting and ending an interview session.
Recording selected browser events, such as tab switches and website navigation.
Associating recorded events with the relevant interview session.
Sending activity records to the Vouch backend.
Informing candidates about what activity is being recorded.
B. Backend System
The central server responsible for processing and managing interview session data.
Its responsibilities include:
Creating and managing interview sessions.
Receiving activity records from the Chrome extension.
Storing session information and recorded events.
Processing activity data into structured session reports.
Supporting report generation and verification.
C. Employer Dashboard
A web application through which employers interact with Vouch.
Its responsibilities include:
Creating interview sessions.
Defining permitted and restricted AI-use policies.
Accessing session reports.
Reviewing recorded browser activity.
Checking whether a session report has been altered after generation.
4. Core Product Workflow
An employer creates an interview session through the Vouch dashboard.
The employer defines the AI-use policy for that session.
The candidate receives the session details and opens the Vouch Chrome extension.
The candidate reviews the monitoring policy, provides consent, and starts the session.
The extension records the browser events permitted by the session configuration.
Activity records are transmitted to the backend and associated with the interview session.
Once the interview ends, Vouch generates a structured session report.
The employer accesses the dashboard to review the report and its verification status.
5. Minimum Viable Product (MVP)
The initial version of Vouch will focus on delivering a complete working workflow rather than implementing every possible feature.
The MVP will include:
Employer account and interview session creation.
Configuration of basic AI-use policies.
Candidate-facing Chrome extension.
Browser tab-switch and website-navigation tracking.
Session-specific activity recording with timestamps.
Backend storage of interview sessions and activity records.
Automated generation of session reports.
Detection of unauthorized changes to generated reports.
Employer dashboard for reviewing and verifying reports.
Advanced AI detection, machine learning-based behavioral analysis, desktop monitoring, and multi-device monitoring are outside the initial MVP scope.

7. Initial Technology Stack
The following technologies are proposed for the first version:
Component
Technology
Frontend
React + TypeScript
Backend
Python + FastAPI
Database
SQLite
Chrome Extension
JavaScript + Chrome Manifest V3
Version Control
Git + GitHub
AI Development Tools
Cursor, Claude, codex etc

Technology choices may be revised as development progresses, provided changes are coordinated across the team.
8. Project Development Approach
Vouch will be developed collaboratively using an AI-assisted software development workflow.
The team will divide ownership across the frontend, backend, Chrome extension, and security components.
Development will follow these principles:
Features will be broken down into small, independently testable tasks.
AI coding tools will assist with implementation.
Each feature must be tested before being integrated into the main codebase.
GitHub will be used to manage code, tasks, and project documentation.
Major technical decisions will be documented centrally.
Team members will collaborate during scheduled development meetings.
9. Project Success Criteria
The initial project will be considered successful when an employer can:
Create an interview session and define its AI-use policy.
Share that session with a candidate.
Have the candidate activate the Vouch extension and complete a monitored session.
Receive a structured record of the browser activity captured during the session.
Review the resulting report through the employer dashboard.
Verify whether the report has been modified since its generation.
The primary objective is to deliver a functional, privacy-conscious interview verification system that demonstrates the feasibility of this approach.

