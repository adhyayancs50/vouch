# Vouch frontend

Employer dashboard for Vouch, the privacy-first interview verification system. Built with React, TypeScript, Vite, and plain CSS.

## Run locally

Use Node.js 22.12+ or a compatible newer LTS version and npm.

```sh
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite uses a strict port so a busy port is reported instead of silently changing the address. On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm.ps1`.

```sh
npm run build
npm run preview
```

The build command checks TypeScript and generates production assets in `dist/`. Preview serves that build locally.

## Current scope

- Responsive employer dashboard, session empty state, and explanation of Vouch.
- Reusable header, icons, empty-state, and information components.
- Accessible section navigation, keyboard focus styles, and a skip link.
- The Create Session button is disabled with an explanatory note. Session creation, authentication, and reports are not implemented.
- A temporary Test Backend Connection button checks the backend health on demand, with loading, success, and error feedback.
- The empty state is the initial interface, not a result fetched from the backend.

## Test the backend connection

1. Keep the existing FastAPI server running at `http://127.0.0.1:8000`. Its `GET /health` endpoint must return a successful HTTP response containing JSON with `"status": "healthy"`.
2. In `frontend/`, copy `.env.example` to `.env.local` if you need to configure the backend URL. The default `VITE_API_BASE_URL` is `http://127.0.0.1:8000`. Use the backend root URL without `/api`, since health is served at `/health`. Update any older local setting that ends in `/api`. Restart Vite after changing environment variables.
3. Run `npm run dev` from `frontend/` (or keep the existing Vite server running), then open `http://localhost:5173`.
4. Click **Test Backend Connection** below the sessions panel. While the request runs, the button is disabled and shows **Testing backend connection…**. A successful healthy response displays **Backend connection successful!**.
5. In browser developer tools, open Network and confirm a `GET` request to `http://127.0.0.1:8000/health` with a successful status and the expected JSON response.
6. To test failure, stop the backend and click again. A connection error should appear and the button should become available for retry. Restart the backend and retry to confirm recovery. HTTP failures, invalid JSON, and a status other than `healthy` also produce errors; requests time out after 10 seconds.

The backend must allow the frontend origin `http://localhost:5173` in its CORS configuration. If `/health` works directly in the browser but the dashboard reports a connection error, check the browser console for a CORS error and verify the allowed origin. This frontend change does not modify backend configuration.

`src/config.ts` exports the centralized `API_BASE_URL`. `src/api.ts` provides a reusable JSON GET utility with HTTP, network, JSON, and timeout handling, plus the health response validation. No request runs until the test button is clicked.

All `VITE_` values are public browser configuration. Never place credentials or secrets in them.

## Docs

See [technical stack and setup](../docs/03-technical-stack-and-setup.md) and [feature specifications](../docs/04-feature-specifications.md).
