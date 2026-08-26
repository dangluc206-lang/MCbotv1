# XP-015 — Structured boot failure và fatal recovery

Status: `DONE`

Backend startup failures are retained in `DesktopController.snapshot().bootFailure` as `desktop-boot-failure-v1`: stage, stable code, sanitized operator/technical summary, workspace-relative config path, correlation ID and catalog actions. The banner persists while lifecycle is failed and clears only after a successful start.

Main-process `uncaughtException`, `unhandledRejection` and bootstrap rejection enter one reentrancy-guarded fatal path: write an atomic redacted marker under Electron userData, run bounded drain, permit one relaunch in a 60-second window, then exit. Renderer termination records a marker and allows one bounded reload per window; repeated crashes remain stopped to prevent a reload loop.
