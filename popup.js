const status = document.querySelector('#status');
const buttons = [...document.querySelectorAll('[data-format]')];

function setStatus(message, type = '') {
  status.textContent = message;
  status.className = type;
}

for (const button of buttons) {
  button.addEventListener('click', async () => {
    buttons.forEach((item) => { item.disabled = true; });
    setStatus('Capturing the page… Please do not interact with the tab.');
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'capture-full-page',
        format: button.dataset.format,
      });
      if (!result?.ok) throw new Error(result?.message || 'The capture could not be started.');
      setStatus(result.message, 'success');
    } catch (error) {
      setStatus(`Failed: ${error.message}`, 'error');
      buttons.forEach((item) => { item.disabled = false; });
    }
  });
}
