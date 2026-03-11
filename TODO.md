# TODO: Add Database with Authentication, Admin Authorization, Rate Limiter, and Frontend API Layer

## Backend Tasks
- [x] Update backend/package.json: Add better-sqlite3, jsonwebtoken, bcryptjs, express-rate-limit
- [x] Create backend/db.js: SQLite setup with tables for users, rooms, saves
- [x] Create backend/auth.js: JWT auth logic, middleware, register/login functions
- [x] Update backend/server.js: Integrate DB, auth middleware, rate limiter, update routes (/api/maps/save, /api/maps/load), add auth routes (/api/auth/register, /api/auth/login), update WebSocket for optional auth

## Frontend Tasks
- [x] Update frontend-react/package.json: Add axios
- [x] Create frontend-react/src/api.js: API layer with axios for backend calls
- [x] Create frontend-react/src/AuthContext.js: Auth context provider for login state, tokens, roles
- [x] Update frontend-react/src/App.js: Integrate AuthContext, use API layer for calls, add login/register modal UI, update save/load/AI calls, handle guest limits

## Followup Steps
- [x] Install dependencies (npm install in both backend and frontend)
- [x] Test auth flow (register/login), DB persistence, rate limiting, WebSocket with auth
- [x] Ensure real-time collaboration still works
