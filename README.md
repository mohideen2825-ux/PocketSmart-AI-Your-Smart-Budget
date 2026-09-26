# PocketSmart AI

A responsive budget recommendation assistant for home interiors, event planning, and jewelry. The frontend uses plain HTML, CSS, and JavaScript; the API is built with FastAPI. Recommendations work in demo mode without credentials and switch to Gemini when an API key is configured.

## Run locally

1. Create a virtual environment: `python -m venv .venv`
2. Activate it in PowerShell: `.venv\Scripts\Activate.ps1`
3. Install dependencies: `pip install -r requirements.txt`
4. Copy `.env.example` to `.env` and add a Gemini API key to enable personalized AI recommendations.
5. Start the app: `uvicorn main:app --reload`
6. Open `http://127.0.0.1:8000`

Without a Gemini key, all three planners return clearly labeled sample marketplace ideas. Marketplace links are search links, not live product listings. Accounts and server-side history are held in memory for this local demo; the browser also saves plan history on the current device.

## Deploy to Render

1. Push this project to a GitHub repository.
2. In Render, choose **New** > **Blueprint**, connect that repository, and deploy the detected `render.yaml`.
3. Render builds the app and provides a public `onrender.com` URL. The Blueprint creates a secret `JWT_SECRET` and checks `/health`.
4. To enable Gemini, add `GEMINI_API_KEY` under the service's environment settings and redeploy. Without it, sample recommendations still work.

The free Render service may take a short time to wake after inactivity. This project keeps accounts and server-side history in memory, so they reset on restarts or redeploys; add a persistent database before using it for real users. If `JWT_SECRET` is omitted, the app creates a random process-local signing key, so sessions also expire after a restart.

## API

- `POST /generate-home`, `POST /generate-party`, `POST /generate-jewelry`
- `POST /register`, `POST /login`, `POST /logout`, `POST /token`
- `GET /session-info`, `GET /session-data`, `GET /history`
- `GET /recommendations-details?id=...`, `GET /health`

Planner requests contain a positive `budget`, a `details` object, and optional base64 `image_data` for jewelry outfit matching. Authenticated requests use `Authorization: Bearer <token>`.