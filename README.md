# Car Counter

A browser-based vehicle counter for a **two-direction roadway / interchange**. It uses
the device camera and an on-device object-detection model (TensorFlow.js COCO-SSD) to
count vehicles crossing a line you draw on screen, tagging each by direction and type.
Everything runs **client-side** — no server, no accounts, nothing leaves the device — and
it works **offline** as an installable PWA.

## What it does

- **Live counting** from the rear camera; counts update on screen in real time.
- **Two directions** (e.g. Northbound / Southbound), decided by which way each vehicle
  crosses the counting line. Labels are editable.
- **Per-vehicle records**: timestamp, direction, vehicle type (car/truck/bus/motorcycle),
  confidence — stored locally in IndexedDB, written the instant each vehicle is counted
  (crash-safe).
- **Approximate by design**: in-browser detection runs ~5–15 FPS on a phone; fast traffic,
  occlusion, and night/low-light reduce accuracy.
- **Flagged clips**: short video clips are saved automatically around *uncertain* counts
  (low confidence or occlusion) for manual review. Clip storage is capped (oldest evicted).
- **Export**: per-session **CSV** (one row per vehicle + a summary block) and **JSON**.
- **Built for long runs** (see Kiosk mode) including 24-hour sessions.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173  (camera works on localhost)
npm run build    # production build into dist/
npm run preview  # serve the production build
```

> **Camera requires HTTPS** (or `localhost`). To use it on a phone in the field, deploy
> the static `dist/` to any HTTPS host (GitHub Pages / Netlify / Vercel) or use an HTTPS
> tunnel to your dev machine. Plain `http://<lan-ip>` will **not** grant camera access.

## How counting works

1. The camera streams into a `<video>` element.
2. COCO-SSD detects vehicles each sampled frame (`src/cv/detector.ts`).
3. A lightweight IOU tracker gives each vehicle a stable id across frames
   (`src/cv/tracker.ts`).
4. When a tracked vehicle's center crosses the counting line, it's counted once; the
   crossing direction picks A vs. B (`src/cv/lineCrossing.ts`).
5. Each count is persisted immediately and, if flagged, a clip is saved.

Drag either end of the dashed line to position it across the lane(s).

## Kiosk mode (long / 24-hour runs)

The app stores **counts, not continuous footage**, so a full day of data is tiny. The real
limits for a day-long run are power, heat, and the screen/tab staying active. For reliable
long runs:

- Use a **dedicated phone/tablet, plugged into power**, mounted with a clear view.
- **Disable OS auto-lock**; the app also holds a **Screen Wake Lock** while counting.
- Keep the **browser app in the foreground** (background tabs get throttled and counting
  pauses).
- The app **auto-resumes** an interrupted session after a reload/crash (totals are kept).
- A **watchdog** restarts the camera/inference if the pipeline stalls.
- Optional **auto-rollover** (Settings) starts a fresh session segment every N minutes so a
  single glitch can never lose a whole day; segments export and combine cleanly.
- Tune **detection interval** up to reduce heat/battery at the cost of FPS.

A phone browser is not a guaranteed *zero-touch* unattended platform — this targets
attended/semi-attended runs.

## Verifying the counting pipeline

Because live traffic isn't available at a desk, the Live screen has a **"load a test video
file"** option (and a "Test clip" button) that feeds a recorded clip through the *same*
detection → tracking → line-crossing pipeline:

1. Start a session, choose **load a test video file**, pick a roadway clip.
2. Drag the dashed line across the lanes.
3. Manually count vehicles crossing the line and compare to the two direction totals;
   confirm no double counts and correct direction.
4. **Persistence**: stop the session, reload — the session and counts survive.
5. **Export**: open the CSV in Excel; confirm one row per vehicle plus the summary block.
6. **Offline**: after first load, go offline and confirm the app still loads and counts
   (model is cached by the service worker).

## Project layout

```
src/cv/        detector, tracker, line-crossing, flagging, cover-mapping
src/hooks/     useCamera, useCounter, useClipRecorder, useWakeLock
src/runtime/   watchdog
src/db/        IndexedDB (sessions / events / clips)
src/export/    CSV + JSON exporters
src/pages/     SessionsList, LiveCount, SessionSummary
src/components/ SettingsDrawer
```

## Tech

Vite · React · TypeScript · Tailwind · TensorFlow.js (COCO-SSD, WebGL) · idb · vite-plugin-pwa.
