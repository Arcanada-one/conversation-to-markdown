# Mutation evidence — C2M-0003 wave 1 (v1.2.0)

Method: `set +e; npm test >/tmp/m.txt 2>&1; echo "EXIT=$?"` (never read exit
code after a pipe). Each row is one mutant applied to the tree, then the full
suite run unless noted.

Baseline before mutations: **57 pass, 0 fail, EXIT=0**.

## A. Partial export on stall

| Field | Value |
| --- | --- |
| **Edit** | In `content.js` `scanTurns`, replace the stall guard body with `throw new Error('Scan stalled');` — remove `markPartialScan(settings, 'stall')` and `return orderCapturedTurns(seen)`. |
| **Test that went red** | `a stalled scan returns partial turns with a notice in the artifact` |
| **EXIT** | **1** |

## B. Partial export on operator cancel

| Field | Value |
| --- | --- |
| **Edit** | In `content.js` `scanTurns`, replace the `isCancelled()` branch with `throw new Error('cancelled');` — remove `markPartialScan` and `return orderCapturedTurns(seen)`. |
| **Test that went red** | `the operator can cancel a scan and keep whatever was captured` |
| **EXIT** | **1** |

## C. Partial export on step-limit (test-only path)

| Field | Value |
| --- | --- |
| **Edit** | In `content.js` `scanTurns`, delete the `if (seen.size > 0) { markPartialScan(..., 'step limit'); return orderCapturedTurns(seen); }` block before the step-limit `throw`. |
| **Test that went red** | `still times out when a reachable scroll target is never approached` |
| **EXIT** | **1** |

**Contract change (explicit):** this test previously asserted `assert.rejects(..., /step limit/)` — scan must throw and discard captured turns. The operator now requires the opposite: a step-limited scan with captured turns returns a partial export (`scanMeta.partial === true`, reason matches `/step limit/`). The test was rewritten accordingly; this mutation proves the new guard.

## D. Partial notice in the markdown artifact

| Field | Value |
| --- | --- |
| **Edit** | In `content.js`, change `prefixPartialNotice` to `return md;` (drop the `> **Partial export**` prefix). |
| **Tests that went red** | `prefixPartialNotice labels the markdown artifact itself`; `a stalled scan returns partial turns with a notice in the artifact` (artifact assertion) |
| **EXIT** | **1** |

## E. `conflictAction: 'overwrite'` on downloads

| Field | Value |
| --- | --- |
| **Edit** | In `popup.js` `downloadOne`, remove `conflictAction: conflictAction \|\| 'overwrite',` from the `chrome.downloads.download` options object. |
| **Tests that went red** | `sets conflictAction explicitly so Chrome does not uniquify to (1).md`; `timestamp checkbox produces a stamped filename for re-export` (also asserts `conflictAction`) |
| **EXIT** | **1** |

## F. Timestamped re-export filename

| Field | Value |
| --- | --- |
| **Edit** | In `popup.js` `buildMdFilename`, replace the `useTimestamp` branch with `return base + '.md';` always. |
| **Test that went red** | `timestamp checkbox produces a stamped filename for re-export` |
| **EXIT** | **1** |

## G. Unexpected errors must not launder into partial export

| Field | Value |
| --- | --- |
| **Edit** | In `content.js` `scanTurns`, restore the broad `catch (error) { if (seen.size > 0) { markPartialScan(...); return orderCapturedTurns(seen); } throw error; }` around the scan loop (replaces the narrowed step-limit-only path). |
| **Test that went red** | `an unexpected scan error propagates even when turns were captured` |
| **EXIT** | **1** |

## H. Popup accepts partial scan success

| Field | Value |
| --- | --- |
| **Edit** | In `popup.js`, change `if (!result.ok)` to `if (!result.ok \|\| result.partial)` so partial exports are treated as errors again. |
| **Test that went red** | `writes a partial export to the clipboard instead of showing an error` |
| **EXIT** | **1** |

## Not run — no red test observed

| Behaviour | Reason |
| --- | --- |
| **Await markdown `downloadOne` before reporting success** (`popup.js` ~line 235) | Mutant: remove `await` before the final `downloadOne` for the `.md` file. Full suite stayed **57 pass, EXIT=0**. No test exercises ordering between download completion and popup status; omitted rather than fabricated. |
| **`getConversationMarkdown` calls `prefixPartialNotice` when `scanMeta.partial`** | No dedicated integration test hits that line in isolation; covered indirectly via **D** (`prefixPartialNotice` itself) and stall/cancel tests that call the helper explicitly. |
