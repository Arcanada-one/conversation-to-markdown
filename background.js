/**
 * Open the side panel from the toolbar button.
 *
 * A popup document is destroyed when the user clicks the page, and the batch
 * running inside it dies with the document. The side panel stays open beside
 * the page. setPanelBehavior is persisted by Chrome; calling it on install,
 * on browser start, and whenever this worker starts covers the first click
 * before that preference exists.
 */
function enableSidePanelClick() {
  if (!chrome.sidePanel || typeof chrome.sidePanel.setPanelBehavior !== 'function') return;
  try {
    var pending = chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    if (pending && typeof pending.catch === 'function') pending.catch(function() {});
  } catch (_e) {
    // An older worker can throw instead of rejecting. The button then does
    // nothing until the next start, which is the same outcome as a rejection.
  }
}

chrome.runtime.onInstalled.addListener(enableSidePanelClick);
chrome.runtime.onStartup.addListener(enableSidePanelClick);
enableSidePanelClick();
