/*
 * PM2, one instance.
 *
 * **It ran three in cluster mode, and that was wrong in two ways at once.**
 *
 * The mock server keeps live state in module-level Maps that never reach disk — `registered`
 * (sources added through the wizard), `profilingJobs`, `studioLive` and `studioDecisions` (graph
 * publication and the review queue), `whatifSaved`, `oauthSessions`, `studioVersions`. Three
 * workers meant three independent copies with requests round-robined between them, so a source
 * registered on one worker was absent from the other two, and publishing a graph — which is what
 * gates Ask, Reports, What-if and Audit — took effect for roughly one request in three.
 *
 * And every writer hands `commitDb` the *whole* document. The per-path write chain in `server.mjs`
 * serializes writes within one process and knows nothing about the others, so two workers writing
 * the full 492 KB meant the last one won and silently discarded the other's edit. There are 14
 * commit call sites.
 *
 * Neither is fixed by a bigger box or a smarter load balancer: both need one writer, or a shared
 * store for state that is deliberately in memory. This app wants the first. Raising `instances`
 * again means moving all of that state out of the process first — see CLAUDE.md, "Where the data
 * lives".
 */
module.exports = {
  apps: [
    {
      name: "mock-server",
      script: "./server.mjs",
      args: "4000",
      /* One writer. See the note above before changing this. */
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      kill_timeout: 5000,
      env: {
        NODE_ENV: "production",
        MOCK_PORT: 4000,
        /*
         * **Set explicitly, because unset now means the local file.** `docRef` defaults to
         * `backend/db.json` so a fresh clone starts with no AWS credentials — and the committed
         * copy is a real, valid document, so a box that *meant* to read the bucket and left this
         * unset would serve stale figures rather than failing. Naming the bucket here is what stops
         * that: this file is how the deployed process is started, so the intent is recorded where it
         * is acted on. The boot banner prints the ref it actually read, which is the second half.
         *
         * Credentials come from the instance role. Region matters — a wrong one signs against the
         * wrong endpoint and answers 403, which reads as a policy problem.
         */
        S3_BUCKET: "contextweave.com",
        S3_PREFIX: "EPA",
        AWS_REGION: "us-east-1",
      }
    }
  ]
};
