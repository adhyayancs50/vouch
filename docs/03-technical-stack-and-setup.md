VOUCH — Technical Stack and Development Setup
1. Purpose of This Document
This document establishes the technologies, software tools, development environment, and coding practices that will be used to build Vouch.
Every team member should follow these instructions to ensure that all components can be developed independently and integrated without unnecessary compatibility issues.

2. Technology Stack
The following technologies have been selected for the initial MVP.
Component
Technology
Purpose
Frontend
React
Builds the employer-facing website.
Frontend language
TypeScript
Adds type checking to frontend code.
Frontend build tool
Vite
Runs and builds the React application.
Backend
Python + FastAPI
Handles requests and connects the components.
Database
SQLite
Stores employers, sessions, events, and reports.
Database integration
SQLAlchemy
Allows Python to communicate with the database.
Browser extension
JavaScript
Implements the candidate-side extension.
Extension standard
Chrome Manifest V3
Defines how the extension operates in Chrome.
API communication
REST API
Allows the extension and dashboard to communicate with the backend.
Version control
Git + GitHub
Manages code and team collaboration.
AI development
Cursor AI
Assists with coding, debugging, and implementation.

3. Required Software and Tools
Every team member should install the following:
A. Cursor AI / Claude Code / Codex etc
B. Git
Git is used to track code changes and collaborate without overwriting one another's work.
Download: https://git-scm.com/
Verify installation:
git --version
C. Node.js and npm
Required for running the React frontend.
Download: https://nodejs.org/
Use Node.js 22 LTS or another team-approved compatible LTS version.
npm is included with Node.js.
Verify installation:
node -v
npm -v
D. Python
Required for the FastAPI backend.
Download: https://www.python.org/downloads/
Use Python 3.11 or newer, subject to compatibility with the selected dependencies.
Verify installation:
python3 --version
On Windows, use:
python --version
E. Google Chrome
F. GitHub Account
4. Initial Development Environment Setup
Once the GitHub repository has been created and everyone has been added as a collaborator, follow these instructions.
Step 1 — Clone the repository
Open Cursor or a terminal and navigate to the folder where you want to store the project.
Run:
git clone YOUR_GITHUB_REPOSITORY_URL
Navigate into the repository:
cd vouch
Replace the placeholder with the actual GitHub repository URL.
Step 2 — Set up the frontend
Navigate into the frontend directory:
cd frontend
If the React application has not yet been initialized, create it using:
npm create vite@latest . -- --template react-ts
Install the required packages:
npm install
Start the development server:
npm run dev
The terminal will display a local development URL, usually:
http://localhost:5173
Open this URL in your browser to view the frontend.
Step 3 — Set up the backend
Open another terminal window.
Navigate to the backend directory:
cd backend
Create a Python virtual environment:
python3 -m venv venv
Activate it on macOS/Linux:
source venv/bin/activate
On Windows:
venv\Scripts\activate
Install the initial backend dependencies:
pip install fastapi "uvicorn[standard]" sqlalchemy pydantic python-dotenv
Save the installed dependencies:
pip freeze > requirements.txt
Start the backend server after its initial application files have been created:
uvicorn app.main:app --reload
The backend should run at:
http://127.0.0.1:8000
FastAPI also provides an interactive API documentation page at:
http://127.0.0.1:8000/docs
This page will allow us to test backend API endpoints directly through a browser.
Step 4 — Set up the Chrome extension
The extension will use JavaScript and Chrome Manifest V3.
Unlike the frontend and backend, it does not require a separate build server for our initial implementation.
Once the extension's manifest.json and other required files have been created:
Open Google Chrome.
Navigate to chrome://extensions.
Enable Developer Mode.
Select Load unpacked.
Select the Vouch extension/ directory.
The extension should appear in the installed extensions list.
Whenever extension files are changed, select Reload on its Chrome extension card to load the latest version.

6. Running the Complete Project Locally
During development, the frontend and backend will run independently on the same computer.
The extension will be loaded directly into Chrome.
The expected setup is:
Component
Local address
Frontend
http://localhost:5173
Backend
http://127.0.0.1:8000
Backend API documentation
http://127.0.0.1:8000/docs
Chrome Extension
chrome://extensions

For the initial MVP, we will use local development environments rather than deploying the application online.
Once the components work together locally, we can move toward deployment.


7. GitHub Collaboration Workflow
All development must take place through GitHub.
We will use separate branches so that multiple people can work on the project without directly modifying the main codebase.
Branch structure
main
Contains the stable version of Vouch.
Feature branches
Each teammate creates a separate branch for their assigned work.
Examples:
feature/chrome-extension
feature/backend-api
feature/employer-dashboard
feature/report-verification
Standard workflow
Every teammate should follow this process:
1. Get the latest code
git checkout main
git pull origin main
2. Create a feature branch
git checkout -b feature/your-feature-name
3. Make changes
Use Cursor to implement the assigned feature.
4. Save changes
git add .
git commit -m "Describe the changes"
5. Upload changes
git push -u origin feature/your-feature-name
6. Create a Pull Request
Open GitHub and create a Pull Request from the feature branch into main.
A Pull Request allows the team to review changes before they become part of the main project.
7. Review and merge
The changes should be reviewed and tested before merging.
Do not directly push unfinished features to main.

8. AI-Assisted Development Guidelines
Vouch will rely heavily on AI coding assistants. Therefore, everyone must follow a consistent approach when using Cursor, ChatGPT, or Claude.
A. Use the central documentation
Before implementing a feature, provide Cursor with the relevant Vouch documentation.
The AI must understand:
What Vouch does.
Which component it is modifying.
The agreed technology stack.
How that component communicates with the other components.
Which existing files and interfaces must remain compatible.
B. Work on one feature at a time
Avoid asking Cursor to build an entire application in a single prompt.
Instead, break development into smaller features.
For example:
Create the Chrome extension popup.
Implement the start-session button.
Detect tab-switch events.
Attach timestamps to events.
Send events to the backend.
Each feature should be tested before proceeding.
C. Do not allow unnecessary changes
Cursor should not independently:
Replace the agreed technology stack.
Rewrite unrelated files.
Change API formats without approval.
Install unnecessary libraries.
Introduce additional frameworks without discussing them with the team.
D. Test generated code
AI-generated code must not automatically be considered correct.
Every implementation should be tested before it is committed.
Team members should share:
What was implemented.
Which files were modified.
Whether the feature works.
Any errors or unresolved issues.
E. Keep AI context updated
When starting a new Cursor conversation, provide the relevant project documentation and explain the feature being implemented.
This helps prevent inconsistent implementations caused by the AI lacking the project's technical context.

9. Environment Variables and Sensitive Information
Certain configuration values may be different across development environments.
These should be stored in environment variables rather than directly inside source code.
Examples include:
Backend database configuration.
Secret keys.
Authentication credentials.
API keys.
Deployment settings.
A .env file should be used for local configuration.
A .env.example file should contain the required variable names without actual secret values.
Important: Never upload .env files, passwords, private API keys, or authentication secrets to GitHub.
Add the appropriate environment files to .gitignore.

10. Development and Testing Standards
Every feature should meet the following requirements before it is considered complete:
The code runs without critical errors.
The feature behaves according to its specifications.
Existing functionality has not been unintentionally broken.
Relevant errors are handled properly.
The implementation is compatible with the agreed architecture.
The teammate responsible can demonstrate that it works.
Changes have been uploaded through a GitHub Pull Request.
We will gradually introduce automated tests as the application develops.
The backend will use pytest for automated testing, while frontend and extension functionality will initially be tested through focused manual demonstrations and automated tests where appropriate.

11. Development Environment Responsibilities
Team member
Primary development environment
Adhyayan
GitHub, Cursor, project documentation, integration
Justin
Cursor, JavaScript, Chrome Developer Tools
Srihith
Cursor, Python, FastAPI, SQLite
Ada
Cursor, React, TypeScript, browser Developer Tools
Javier
Cursor, Python, security and verification testing

All team members should have access to the complete repository, even if they primarily work on one component.

12. Final Development Rules
The following rules will apply throughout Vouch's development:
GitHub is the single source of truth for project code and documentation.
The main branch must remain stable.
Every feature should have a defined task and an assigned owner.
All components must follow the agreed system architecture.
AI coding assistants must not independently change major technical decisions.
All significant changes must be reviewed before merging.
Working functionality takes priority over unnecessary complexity.
Documentation should be updated whenever an important technical decision changes.

13. Definition of a Ready Development Environment
A team member is considered ready to contribute when they can:
Access the Vouch GitHub repository.
Open the project in Cursor.
Run the component they are responsible for.
Create and work on a GitHub feature branch.
Commit and push code.
Create a Pull Request.
Use the project's documentation to guide AI-assisted development.
The objective is to establish one consistent development environment across the team so that development and integration can proceed smoothly.

