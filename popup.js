const status = document.querySelector('#status');
const buttons = [...document.querySelectorAll('[data-format]')];
const cancelButton = document.querySelector('#cancel');

function setStatus(message, type = '') {
  status.textContent = message;
  status.className = type;
}

function setCapturing(active) {
  buttons.forEach((item) => { item.disabled = active; });
  cancelButton.hidden = !active;
  if (!active) cancelButton.disabled = false;
}

for (const button of buttons) {
  button.addEventListener('click', async () => {
    setCapturing(true);
    setStatus('Capturing the page… Please do not interact with the tab.');
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'capture-full-page',
        format: button.dataset.format,
      });
      if (!result?.ok) throw new Error(result?.message || 'The capture could not be started.');
      setStatus(result.message, 'success');
      setCapturing(false);
    } catch (error) {
      setStatus(`Failed: ${error.message}`, 'error');
      setCapturing(false);
    }
});

cancelButton.addEventListener('click', async () => {
  cancelButton.disabled = true;
  setStatus('Cancelling capture…');
  await chrome.runtime.sendMessage({type: 'cancel-capture'});
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'capture-progress') return;
  setCapturing(message.active);
  if (message.message) setStatus(message.message);
});

chrome.runtime.sendMessage({type: 'get-capture-status'}).then((result) => {
  if (!result?.active) return;
  setCapturing(true);
  setStatus(result.message);
});
}
