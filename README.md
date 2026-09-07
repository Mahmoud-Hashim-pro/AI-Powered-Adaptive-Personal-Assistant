Super Human
An adaptive, accessible AI study mentor
Super Human is an AI mentor that recalibrates its tone, vocabulary, and interaction
style to each user — and is built from the ground up to be usable by people with
visual, hearing, speech, and cognitive accessibility needs.
📌 The Problem
Most learning tools and AI chatbots are "one-size-fits-all":
Cognitive mismatch: beginners drown in jargon; advanced users get oversimplified answers.
No memory of who you are: standard tools ignore your field, level, and history.
Poor accessibility: rigid text interfaces exclude blind, deaf, and speech-impaired users.
🚀 The Solution
Super Human adapts its entire persona to the user's profile (level, role, field,
language, accessibility mode) and mirrors the user's language and dialect —
including Egyptian Arabic. It's a long-term cognitive mentor, not just an answer bot.
✨ Key Features
Cognitive recalibration: simple analogies for Basic, professional vocabulary for Intermediate, rigorous depth for Advanced.
Identity-aware answers: tailored to your university/faculty or job/field, with cross-thread memory.
Accessibility suite:
Visual mode — narratable, screen-reader-friendly responses.
Sign / Deaf mode — a 3D sign avatar (Three.js), live captions, and a Sign Studio.
Speech mode — TTS-friendly prose, plus dysarthria/atypical-speech decoding (Project Euphonia–style).
Multimodal: analyze images and documents in chat.
Gamified growth: Health Score, points, and progress tracking.
Admin dashboard: tiered access — Super Admin (can promote/demote) above Admin — with a live user directory.
Support Center: built-in FAQ + contact.
🛠 Tech Stack
Frontend: React 19, TypeScript, Vite 6, Tailwind CSS v4, Lucide Icons, Motion, Recharts, react-markdown
Auth & Data: Firebase Authentication + Cloud Firestore (multi-database aware)
AI: Google Gemini (gemini-2.5-flash, with 2.0-flash / flash-latest fallback) and an automatic Groq / xAI fallback when Gemini is rate-limited
Accessibility/ML: Three.js (sign avatar), MediaPipe Hands + TensorFlow.js (gesture/sign), Web Speech API
Monitoring (optional): Sentry
🏗 Architecture
Super Human is client-first and ships as a static site (e.g. Vercel): the
browser talks to Gemini/Groq directly, so no backend is required in
production. An Express server (server.ts) is included for local development and
optional self-hosting, which adds server-side /api routes; when those aren't
present, the app automatically falls back to direct client calls.
🔑 Environment Variables
VITE_-prefixed keys are bundled into the client (publicly visible) — use them
for static hosting. See .env.example for the full template.
Variable
Required
Purpose
VITE_GEMINI_API_KEY
✅
Gemini key(s). Comma-separate several to multiply free quota; the app rotates on rate-limit.
VITE_GROQ_API_KEY
optional
Groq fallback (free, fast). Keys start with gsk_.
VITE_XAI_API_KEY
optional
xAI/Grok fallback. Keys start with xai-.
VITE_SENTRY_DSN
optional
Sentry error tracking (public DSN).
Firebase config lives in firebase-applet-config.json (project, app, and firestoreDatabaseId). Firestore security rules are in firestore.rules and
must be published to the same database the app uses.
⚠️ VITE_ keys are visible in the built client. For production hardening,
restrict the keys (HTTP referrer / API restrictions) or proxy them via the
Express backend.
💻 Run Locally
Prerequisites
Node.js v18+
Setup
Code
Other scripts
Script
Description
npm run dev
Local dev server (server.ts).
npm run build
Build the static client + bundle the server.
npm run preview
Preview the production build.
npm run lint
Type-check (tsc --noEmit).
🚀 Deployment
Deploy the static build to any static host (Vercel recommended). Set the VITE_* environment variables in your host's dashboard and redeploy after any change
— VITE_ values are baked in at build time.
Built to redefine personalized, accessible learning.