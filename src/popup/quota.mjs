/** Classify a per-conversation failure so the run can react instead of
 *  burning through the remaining list.
 *
 *  A dropped network is NOT a property of the conversation being exported: on
 *  a 40-conversation run it would otherwise fail 39 more times and report 39
 *  broken conversations. Offline and unreachable are therefore HOLD conditions,
 *  while a genuine per-conversation problem is RETRY then SKIP. */
function classifyBatchFailure(message) {
  var text = String(message || '').toLowerCase();
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return 'offline';
  if (/failed to fetch|network ?error|net::|err_internet|err_network|err_name_not_resolved|err_connection/.test(text))
    return 'offline';
  if (
    /\b(?:502|503|504)\b|bad gateway|service unavailable|gateway timeout|too many requests|\b429\b|rate limit|slow down|try again later/.test(
      text
    )
  )
    return 'unreachable';
  if (/did not load|timed out|timeout/.test(text)) return 'transient';
  return 'conversation';
}

/** Exponential backoff with a finite budget: 1s, 2s, 4s, capped. */
function backoffDelayMs(attempt) {
  return Math.min(1000 * Math.pow(2, Math.max(0, attempt - 1)), 8000);
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/** How many ChatGPT calls a batch may start in one minute.
 *
 *  Observed on 2026-10-10: a continuous export began receiving errors from
 *  ChatGPT after about 50 sessions, with no pause between them. The rate that
 *  still succeeds was not measured, so 30 is not a midpoint between two
 *  populations. Each session is counted as OPENAI_PAGE_LOAD_CALLS for the
 *  page load the navigation causes, plus the extension's own reads. Fifty
 *  page loads is 200 counted calls, a little over six minutes of budget
 *  before the time the scans themselves take. A slower run can be resumed.
 *  Reading a rate-limit error as "this conversation is broken" and skipping
 *  it cannot be repaired by re-running if the skip is then treated as done.
 */
var OPENAI_CALLS_PER_MINUTE = 30;
var OPENAI_CALL_WINDOW_MS = 60000;
/**
 * How long to wait before clicking ChatGPT's Retry control.
 *
 * Measured 2026-10-14 from a saved chatgpt.com conversation page: after too
 * many page opens the active thread has no messages and one Retry button
 * ("Could not load this ChatGPT conversation"), and the sidebar has a settled
 * role=status ("Unable to load history") with its own Retry button. aria-busy
 * is false. The page does not say "rate limit" and shows no countdown.
 * Recovery time was not measured. This wait reuses the one-minute call window
 * above, which is also not a measured recovery time. Clicking Retry immediately
 * repeats the failed read.
 */
var RATE_LIMIT_RETRY_WAIT_MS = OPENAI_CALL_WINDOW_MS;
/** Presses of Retry before the run stops instead of opening the next chat. */
var RATE_LIMIT_RETRY_CLICKS = 5;
var OPENAI_PAGE_LOAD_CALLS = 4;
var OPENAI_METADATA_CALLS = 2;
var OPENAI_FILE_LOOKUP_CALLS = 2;

/** Sliding window of call times. `take(n)` waits until n more calls fit. */
function createCallQuota(limit, windowMs, now, wait, onWait) {
  var times = [];
  var cap = typeof limit === 'number' ? limit : OPENAI_CALLS_PER_MINUTE;
  var span = typeof windowMs === 'number' ? windowMs : OPENAI_CALL_WINDOW_MS;
  var clock =
    now ||
    function () {
      return Date.now();
    };
  var sleepFn = wait || sleep;
  return {
    limit: cap,
    take: async function (count) {
      var need = count > 0 ? Math.floor(count) : 1;
      var frozen = 0;
      for (;;) {
        var t = clock();
        var kept = [];
        for (var i = 0; i < times.length; i++) {
          if (t - times[i] < span) kept.push(times[i]);
        }
        times = kept;
        if (times.length + need <= cap) {
          for (var n = 0; n < need; n++) times.push(t);
          return;
        }
        var delay = span - (t - times[0]);
        if (delay < 1) delay = 1;
        if (onWait) onWait(delay);
        var before = t;
        await sleepFn(delay);
        // A harness that collapses timers without moving the clock would spin
        // here forever. One collapsed sleep is ignored; a second means the
        // clock is not a clock, and the run continues. Date.now advances
        // during a real sleep, so this branch is not the production path.
        if (clock() === before) {
          frozen += 1;
          if (frozen > 1) {
            for (var k = 0; k < need; k++) times.push(clock());
            return;
          }
        } else {
          frozen = 0;
        }
      }
    },
  };
}

/** Block while the operator has paused, and report cancellation. */
async function waitWhilePaused(controls) {
  while (controls && controls.isPaused && controls.isPaused()) {
    if (controls.isCancelled && controls.isCancelled()) return false;
    await sleep(250);
  }
  return !(controls && controls.isCancelled && controls.isCancelled());
}

export {
  backoffDelayMs,
  classifyBatchFailure,
  createCallQuota,
  OPENAI_CALL_WINDOW_MS,
  OPENAI_CALLS_PER_MINUTE,
  OPENAI_FILE_LOOKUP_CALLS,
  OPENAI_METADATA_CALLS,
  OPENAI_PAGE_LOAD_CALLS,
  RATE_LIMIT_RETRY_CLICKS,
  RATE_LIMIT_RETRY_WAIT_MS,
  sleep,
  waitWhilePaused,
};
