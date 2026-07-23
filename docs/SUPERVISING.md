# Supervising Zac the Ripper

This document is the contract for an external process — a Claude session, a shell script, a monitoring dashboard — that wants to watch or intervene in a running Zac the Ripper session without using the UI. Everything here is read from plain files on disk; no IPC or Electron access is required.

## Where the files are

All observability output lives under one directory, resolved the same way regardless of whether the app is running:

| Platform | Path |
|---|---|
| macOS | `~/Library/Logs/Zac the Ripper/` |
| Windows | `%APPDATA%\Zac the Ripper\logs\` |
| Linux | `$XDG_STATE_HOME/zac-the-ripper/logs/` (falls back to `~/.local/state/zac-the-ripper/logs/`) |

```
Zac the Ripper/
├── main.log            # human-readable log, rotates at 10MB (keeps one .1 backup)
├── main.log.1
├── events.jsonl         # structured lifecycle events, one JSON object per line, rotates at 20MB
├── events.jsonl.1
├── status.json          # point-in-time snapshot, rewritten every 5s and on every job transition
└── jobs/
    └── <jobId8>-<tool>.log   # full raw stdout+stderr transcript per tool invocation
```

## The three views, and when to use each

**`status.json` — "what's happening right now"**. Read this first. It's a small atomic snapshot (write-temp-then-rename, so you'll never read a half-written file) with the app's pid, version, uptime, and every active job's type/status/progress. If `updatedAt` is more than ~15 seconds old, the app is either not running or has hung — the heartbeat/snapshot timer runs every 5s.

```json
{
  "pid": 41823,
  "version": "2.5.0-dev",
  "startedAt": "2026-07-17T20:10:03.112Z",
  "updatedAt": "2026-07-17T20:14:18.902Z",
  "activeJobs": [
    { "jobId": "a1b2c3d4-...", "dbId": 17, "type": "jellyfin_export", "status": "running", "progress": 42.5, "message": "Step 2/3 — Encoding HEVC: 43%" }
  ],
  "lastError": null
}
```

Note: `progress`/`message` are populated for the media-library export pipeline (`mkv_rip`/`jellyfin_export`/`plex_export`/`kodi_export`) and the music/CD pipeline (`music_export`) — the two workflows that matter for day-to-day ripping. Standalone `raw_capture` and standalone FFV1/H264/HEVC encode jobs (queued outside the main pipeline) show status but not live percentage.

**`events.jsonl` — "what happened, in order"**. `tail -f events.jsonl | jq` gives you a live feed of discrete lifecycle events: jobs created, phase transitions, completions, failures, cancellations, app start/quit, crashes, and a heartbeat every 60s. It deliberately does *not* include every progress tick (that's what `status.json` is for) — this stream stays low-volume and meaningful.

Event types: `app_start`, `app_quit`, `disc_detected`, `disc_ejected`, `job_created`, `phase_changed`, `progress`, `read_error`, `watchdog_kill`, `job_completed`, `job_failed`, `job_cancelled`, `heartbeat`, `crash`.

Every line has `ts` (ISO timestamp) and `event`; the rest of the fields depend on the event type. Example:

```jsonl
{"ts":"2026-07-17T20:10:03.115Z","event":"app_start","pid":41823,"version":"2.5.0-dev"}
{"ts":"2026-07-17T20:10:41.203Z","event":"job_created","dbId":17,"jobType":"jellyfin_export","discId":4,"movieTitle":"Best in Show"}
{"ts":"2026-07-17T20:10:41.210Z","event":"phase_changed","dbId":17,"phase":"running"}
{"ts":"2026-07-17T20:24:55.667Z","event":"job_completed","dbId":17,"outputPath":"/Users/.../Best in Show (2000).mkv"}
```

**`jobs/<jobId8>-<tool>.log` — "what the tool actually said"**. When something goes wrong, `main.log` and `events.jsonl` tell you *that* it failed; these transcripts tell you *why*. Each is the complete, unfiltered stdout+stderr of one MakeMKV/ffmpeg/cdparanoia invocation — including everything the app's own logger filters out at the default log level (raw robot-protocol lines, full ffmpeg stderr, etc.). Filenames use the first 8 characters of the job's UUID plus the tool name, e.g. `a1b2c3d4-makemkv.log`, `a1b2c3d4-ffmpeg.log`. A job that goes through multiple phases (rip → encode) produces multiple transcript files sharing the same jobId prefix, one per tool.

`main.log` itself is the fallback for everything else — human-readable, same rotation scheme, includes whatever the app's logger emitted at the current log level (default `info`; see below to raise it).

## Raising the log level

Debug-level logging (raw MakeMKV/ffmpeg/cdparanoia stderr, verbose disc-detection output) is off by default. To enable it, set an environment variable before launching the app:

```bash
ZTR_LOG_LEVEL=debug open -a "Zac the Ripper"
# or, running from source:
ZTR_LOG_LEVEL=debug npm run dev
```

There is currently no way to change this at runtime without restarting the app.

## What "supervising" can mean in practice

- **Detect a stall.** Compare `status.json`'s `updatedAt` to now. If the app is alive but a job's `progress` hasn't changed across two or three 5-second reads while its `message` also hasn't changed, the pipeline is likely stuck (or MakeMKV is deadlocked and the watchdog hasn't fired yet — check `events.jsonl` for a `watchdog_kill` event, and the relevant `jobs/*-makemkv.log` for the raw evidence).
- **Detect a crash.** `events.jsonl` gets a `crash` event (with `source`: `uncaughtException`, `unhandledRejection`, `render-process-gone`, or `child-process-gone`) before the process exits or the window dies. `status.json`'s `lastError` also carries the most recent one.
- **Diagnose a failed rip.** Find the `job_failed` event in `events.jsonl` for the `dbId` in question, then read `jobs/<jobId8>-makemkv.log` (or `-ffmpeg.log`, `-ffmpeg-vob.log`, `-cdparanoia.log` depending on which phase failed) for the tool's actual output.
- **Confirm a cancel took effect.** `job:cancel` (called from the UI, or via IPC if you're driving the app directly) triggers cooperative cancellation — MakeMKV, ffmpeg, and cdparanoia are all signaled, and the pipeline checks a cancellation flag between phases rather than running to completion. Watch for the `job_cancelled` event; the DB (and `status.json`) will never show `completed` for a job that was cancelled, even if the pipeline takes a few seconds to actually unwind.

## What this does *not* give you

- **No remote/network access.** Everything here is local files. If you need to supervise a rip on a different machine, you need filesystem access to it (e.g. a mounted volume, `ssh` + `tail`).
- **No write path for control.** These files are read-only observability — there's no `commands.jsonl` or similar for issuing instructions. Controlling the app (starting/cancelling jobs) still goes through its IPC API, which requires driving the Electron app itself.
- **No historical query interface.** `events.jsonl` and `main.log` rotate at a fixed size with exactly one backup (`.1`) — for anything beyond that, the SQLite database (`jobs`, `discs`, `output_files` tables) is the durable historical record, not these log files.
