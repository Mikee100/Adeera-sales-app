# POS Remote Update Rollout and Rollback Playbook

## Purpose

This playbook defines how to safely push POS app updates to clients and recover quickly if a release causes issues.

## Release Channels

- stable: Production clients
- beta: Pilot clients only

Use beta first, validate, then promote to stable.

## Required Artifacts Per Release

- SaaS POS Setup <version>.exe
- SaaS POS Setup <version>.exe.blockmap
- latest.yml

For staged rollout, host separate feeds:

- stable feed: /updates/pos/
- beta feed: /updates/pos-beta/

## Standard Rollout Process

1. Bump app version in package.json.
2. Build release artifacts.
3. Publish artifacts to beta feed.
4. Set pilot clients to beta channel in Settings > System > App Updates.
5. Monitor for 24-48 hours.
6. Publish same artifacts to stable feed.
7. Keep previous release artifacts available for rollback.

## Client Update Behavior

1. POS checks update feed.
2. If newer version exists, update downloads in background.
3. Operator clicks Install Downloaded Update.
4. App restarts into new version.

## Emergency Rollback

If the current release is faulty:

1. Stop publishing the faulty release to stable feed.
2. Restore previous known-good latest.yml and installer files in stable feed.
3. Ask clients to click Check for Updates.
4. Confirm clients receive previous stable version.

## Hotfix Procedure

1. Branch from last known-good commit.
2. Apply minimal fix.
3. Release to beta first.
4. Validate quickly on pilot devices.
5. Promote to stable.

## Operational Checklist

- Use HTTPS for all feeds.
- Sign installer executables.
- Keep at least two previous versions available.
- Maintain release notes for each version.
- Validate print, sync, and login flows before stable promotion.
