const status = document.querySelector('#status');
const buttons = [...document.querySelectorAll('button')];

for (const button of buttons) {
  button.addEventListener('click', async () => {
    buttons.forEach((item) => { item.disabled = true; });
    status.textContent = 'Capturing… Please do not interact with the tab.';
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'capture-full-page',
        format: button.dataset.format,
      });
      if (!result?.ok) throw new Error(result?.message || 'The capture could not be started.');
      status.textContent = result.message;
    } catch (error) {
      status.textContent = `Failed: ${error.message}`;
      buttons.forEach((item) => { item.disabled = false; });
    }
  });
}
