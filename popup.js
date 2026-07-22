const btn = document.getElementById('btn-copy');
const status = document.getElementById('status');

function showStatus(type, message) {
  status.className = type;
  status.textContent = message;
}

btn.addEventListener('click', async () => {
  btn.disabled = true;
  btn.textContent = 'Scanning conversation…';
  status.className = '';
  status.textContent = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.match(/https:\/\/(chatgpt\.com|chat\.openai\.com)\//)) {
      showStatus('error', 'Open a ChatGPT conversation page first.');
      return;
    }

    // Inject content script if not already loaded
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => getConversationMarkdown(),
    });

    const result = results?.[0]?.result;

    if (!result) {
      showStatus('error', 'Could not get result from page.');
      return;
    }

    if (!result.ok) {
      showStatus('error', result.error || 'Unknown error');
      return;
    }

    // Write to clipboard from popup context — this is where the permission actually works
    await navigator.clipboard.writeText(result.md);

    showStatus(
      'success',
      `✓ Copied! ${result.lines} lines · ${result.words} words`
    );
  } catch (err) {
    showStatus('error', err.message || String(err));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Copy as Markdown';
  }
});
