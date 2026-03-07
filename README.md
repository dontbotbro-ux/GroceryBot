# grobots

`grobots` is a local grocery-deal dashboard for Wegmans, Walmart, Aldi, Lidl, and Target.
It scrapes official deal pages into `public/store-data.json`, lets you track deals in the UI,
and can send a refreshed summary to your iMessage number on a configurable schedule.

## Run locally

Frontend only:

```bash
npm install
npm run dev
```

Frontend plus iMessage notifier service:

```bash
npm install
npm run dev:full
```

If you prefer separate processes:

```bash
npm run notifier:service
npm run dev
```

## iMessage summaries

- The notifier service is macOS-only and uses the local Messages app through AppleScript.
- Scheduled summaries are managed with a LaunchAgent at `~/Library/LaunchAgents/com.grobots.deal-summary.plist`.
- Every scheduled or manual send refreshes the deal feed first, then builds the summary, then sends it.
- The app UI lets you configure the destination number, daily or weekday schedule, selected stores,
  summary scope, and per-store deal count.

## Useful commands

```bash
npm run scrape:stores
npm run notifier:service
npm run send:summary
npm run build
```
