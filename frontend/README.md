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
- The Create Session button is disabled with an explanatory note. Session creation, authentication, reports, and backend requests are not implemented.
- The empty state is the initial interface, not a result fetched from the backend.

## Future backend integration

Copy `.env.example` to `.env.local` to configure `VITE_API_BASE_URL`. The default is `http://127.0.0.1:8000/api`, matching the project documentation. Restart Vite after changing environment variables.

`src/config.ts` exports the centralized `API_BASE_URL` for a future API layer. No endpoints or simulated API calls are implemented. Future requests must follow the documented API contracts and coordinate backend CORS configuration for the frontend origin.

All `VITE_` values are public browser configuration. Never place credentials or secrets in them.

## Docs

See [technical stack and setup](../docs/03-technical-stack-and-setup.md) and [feature specifications](../docs/04-feature-specifications.md).
