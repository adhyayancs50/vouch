VOUCH — Team Workflow and Project Management
1. Purpose
This document establishes how the Vouch team will organize development, assign responsibilities, communicate, manage GitHub, and integrate code.
The objective is to maintain a coordinated development process where everyone understands their responsibilities and can contribute without creating conflicts between different parts of the application.
Vouch will follow a collaborative, AI-assisted development approach. Work will be divided by component ownership, while major technical decisions and integration will be coordinated centrally.
2. Team Structure and Responsibilities
Each team member will have ownership of a primary area of development.
Adhyayan — Project Lead, Architecture and Integration
Responsibilities:
Maintain the overall technical direction of Vouch.
Define project milestones and development priorities.
Break down larger features into smaller implementation tasks.
Prepare detailed AI coding prompts for assigned tasks.
Maintain project documentation.
Manage GitHub Issues, branches, and project progress.
Coordinate integration between the frontend, backend, and extension.
Review major code changes before they are merged.
Identify blockers and coordinate solutions.
Justin — Chrome Extension Development
Responsibilities:
Develop the candidate-facing Chrome extension.
Implement session joining and session controls.
Implement browser activity tracking.
Connect the extension to the backend.
Test extension functionality in Chrome.
Coordinate with Srihith on event submission and session management.
Srihith — Backend Development
Responsibilities:
Develop the Python backend using FastAPI.
Implement the API endpoints defined in Document 05.
Design and maintain the database.
Implement session creation and management.
Receive, validate, and store browser activity events.
Generate structured session reports.
Coordinate API integration with Ada and Justin.
Ada — Frontend Development
Responsibilities:
Develop the employer-facing dashboard.
Implement session creation and policy configuration interfaces.
Build the session details and report pages.
Connect the frontend to the backend.
Ensure the dashboard displays information correctly.
Coordinate with Srihith on API integration.
Javier — Security, Privacy and Verification
Responsibilities:
Review the system's privacy and security requirements.
Identify potential ways activity records and reports could be manipulated.
Help implement report integrity verification.
Review session access controls and authentication.
Test report verification functionality.
Coordinate security-related implementation with Srihith and Justin.
Security and privacy should be considered throughout development rather than treated as a separate final-stage task.

3. Development Workflow
Vouch will use a structured development process.
Step 1 — Feature Selection
The project lead identifies the next feature to implement based on the development roadmap.
The feature must have a clearly defined purpose and expected outcome.
Step 2 — Task Breakdown
The feature is divided into smaller implementation tasks.
Each task must have:
A clear objective.
An assigned owner.
Relevant documentation.
Expected functionality.
Testing requirements.
Completion criteria.
Step 3 — AI Coding Prompt Preparation
The project lead prepares a detailed implementation prompt for the assigned teammate.
The prompt should explain:
What needs to be built.
Which component is being modified.
Which files are relevant.
Which technologies must be used.
Which existing interfaces must remain unchanged.
How the feature should be tested.
Step 4 — Implementation
The assigned teammate uses Cursor or another AI coding assistant to implement the feature.
They remain responsible for reviewing the generated code, running it, and confirming that it works.
Step 5 — Testing
The teammate tests the feature against its completion criteria.
Any errors must be resolved before the feature is submitted for integration.
Step 6 — GitHub Submission
The teammate commits their changes to a feature branch and opens a Pull Request.
The project lead or designated reviewer checks the changes before merging.
Step 7 — Integration
Once approved, the changes are merged into the main branch.
The team then tests the updated application to ensure existing functionality still works.
5. GitHub Project Management
GitHub will serve as the central platform for managing code and development progress.
Repository
All project source code and official documentation must be stored in the Vouch repository.
GitHub Issues
Every significant development task should have a GitHub Issue.
Each Issue should include:
Task title.
Description.
Assigned teammate.
Relevant documentation.
Expected result.
Completion criteria.
Issue Labels
The following labels should be used:
Label
Purpose
frontend
Employer dashboard tasks.
backend
Backend and database tasks.
extension
Chrome extension tasks.
security
Security and privacy tasks.
integration
Connecting different components.
documentation
Documentation updates.
bug
Existing functionality that needs fixing.
priority-high
Important development tasks.

Issue Status
Issues should move through these stages:
Backlog — Not yet scheduled.
Ready — Requirements and instructions are finalized.
In Progress — Development has started.
Review — Implementation is awaiting review.
Done — Feature has been tested and integrated.
GitHub Projects may be used to display these stages on a shared board.
6. Git Branching and Code Review
The main branch must always contain the most stable version of Vouch.
Team members should work on separate feature branches.
Examples:
main
feature/chrome-session-tracking
feature/backend-session-api
feature/employer-dashboard
feature/report-verification
Rules
Do not directly push unfinished code to main.
Pull the latest changes before starting new work.
Keep each branch focused on a specific feature.
Use meaningful commit messages.
Create a Pull Request before merging.
Review changes for compatibility with the system architecture.
Test the integrated application after significant merges.
The project lead will coordinate final integration and maintain the stability of the main branch.

