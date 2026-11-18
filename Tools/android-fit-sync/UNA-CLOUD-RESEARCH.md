# UNA account import research

Research date: 2026-11-18. **Paused; not part of the app's sync path.**
Static inspection of the installed official Android app (`com.unawatch`),
unauthenticated HTTP checks, and an interactive SMS/account-identification
experiment. No credentials were extracted from the official app and no
authenticated activity downloads were completed.

The experimental `cloud_probe.py` remains for reference and is not bundled in
the APK. The SMS endpoint did not confirm a completed account, so research
stopped before verification. Do not resume login/SMS experiments without a new
request. Manual official-app sharing and native Bluetooth are the working paths.

## Findings

- Native APK strings include `https://api.unawatch.com/`; the JavaScript HTTP
  client reads `BASE_API_URL`.
- The endpoint table defines `/sync/pull?lastPulledAt=<value>` and
  `/sync/<activity identifier>/file`.
- `getPresignedGetUrlForActivity` calls the HTTP client's GET method on the
  latter route and returns the response data. This establishes a cloud file
  retrieval mechanism in the client, not a tested third-party API contract.
- Authentication routes include `/auth/sign-in/phone-number`,
  `/auth/sign-in/phone-number/verify`, and `/auth/refresh-token`.
  The HTTP client includes Bearer authorization handling.
- GET `/` returned 401; `/openapi.json` and `/docs` returned 404.
  These checks do not establish that documentation is unavailable elsewhere.
- Manual official-app Download → Android Share → UNA Activity was tested with
  a SleepVue recording: FIT integrity checks and sleep-stage recognition passed.

## Open questions

- Does UNA support third-party access, with delegated authorization or an
  independent read-only account session?
- What is the sync-pull response schema, initial cursor, pagination behavior,
  and activity identifier format?
- What does the signed-file response contain, and how long is it valid?
- Would a second sign-in invalidate the official app's session?
- What polling limits and retention guarantees apply?

## Integration direction

Keep the official app as the watch collector. With supported account access,
our app could pull activity changes, download FIT files, validate and deduplicate
them locally, and retain its own import cursor. Do not replay the official app's
entire database synchronization protocol or send sync-push/deletion requests.

No production cloud integration has been implemented. The existing offline/shared-file
workflow remains the tested path. Confirm a supported authorization method with
UNA before implementing login against these undocumented routes.

Related developer discussion (GPS assistance, not activity authorization):
https://dev.unawatch.com/t/gps-assistance-data-epo-for-watches-paired-with-sailfish-os/171
