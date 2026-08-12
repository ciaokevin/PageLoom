const CAPTURE_DELAY_MS = 550; // Chrome permits at most two visible-tab captures per second.
// Chromium caps a canvas dimension near 32,767 px. Keep a small buffer for rounding.
const MAX_PNG_HEIGHT = 32_700;
// WebP encoders can silently truncate very tall canvases on some Chromium builds.
// Keep compact exports below a conservative height so the complete page survives.
const MAX_WEBP_HEIGHT = 16_000;
// A hard cap keeps infinite or virtualized feeds (such as social timelines) responsive.
// Pages longer than this are exported as their currently loaded portion.
const MAX_CAPTURED_SECTIONS = 50;
let captureInProgress = false;
let captureCancelRequested = false;
let captureProgress = {active: false, message: ''};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'cancel-capture') {
    captureCancelRequested = true;
    sendResponse({ok: true, message: 'Cancelling capture…'});
    return;
  }
  if (message?.type === 'get-capture-status') {
    sendResponse({ok: true, ...captureProgress});
    return;
  }
  if (message?.type !== 'capture-full-page') return;

  if (captureInProgress) {
    sendResponse({ok: false, message: 'A capture is already in progress.'});
    return;
  }
  captureInProgress = true;
  captureCancelRequested = false;
  setCaptureProgress(true, 'Preparing capture…');
  captureCurrentPage(message.format)
    .then((messageText) => sendResponse({ok: true, message: messageText}))
    .catch((error) => sendResponse({ok: false, message: error.message}))
    .finally(() => {
      captureInProgress = false;
      captureCancelRequested = false;
      setCaptureProgress(false, '');
    });
  return true;
});

function setCaptureProgress(active, message) {
  captureProgress = {active, message};
  chrome.runtime.sendMessage({type: 'capture-progress', ...captureProgress}).catch(() => {});
}

async function captureCurrentPage(format) {
  if (!['png', 'webp', 'pdf'].includes(format)) throw new Error('Unsupported file format.');

  const [tab] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
  if (!tab?.id || tab.windowId === undefined) throw new Error('Could not find a tab to capture.');
  if (!/^https?:|^file:/.test(tab.url ?? '')) {
    throw new Error('Chrome security restrictions prevent capturing this page.');
  }

  const originalY = await runInTab(tab.id, () => window.scrollY);
  let metrics;
  const captures = [];
  const hideToken = `full-page-capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let partialCapture = false;

  try {
    // Do this before measuring: hiding the scrollbar can slightly change viewport width.
    // Fixed/sticky UI is marked after the first tile, so the header remains in the first image only.
    await runInTab(tab.id, (token) => {
      const selector = `[data-full-page-capture-hidden="${token}"]`;
      const style = document.createElement('style');
      style.id = `full-page-capture-style-${token}`;
      style.textContent = `
        ${selector} { visibility: hidden !important; }
        html, body { scrollbar-width: none !important; }
        *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
      `;
      document.documentElement.append(style);
    }, [hideToken]);

    metrics = await runInTab(tab.id, () => ({
      height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    }));
    if (!metrics.height || !metrics.viewportHeight) throw new Error('Could not determine the page size.');

    let targetY = 0;
    let previousY = -1;
    let reachedBottomOnce = false;
    while (targetY !== previousY || !reachedBottomOnce) {
      if (captureCancelRequested) throw new Error('Capture cancelled.');
      if (captures.length >= MAX_CAPTURED_SECTIONS) {
        partialCapture = true;
        break;
      }
      previousY = targetY;
      const actualY = await runInTab(tab.id, async (y, delay) => {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return window.scrollY;
      }, [targetY, CAPTURE_DELAY_MS]);

      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {format: 'png'});
      if (!captures.length || captures.at(-1).y !== actualY) captures.push({y: actualY, dataUrl});
      setCaptureProgress(true, `Capturing section ${captures.length} of ${MAX_CAPTURED_SECTIONS}…`);

      // Keep navigation visible at the top of the exported page, then prevent repetition.
      if (captures.length === 1) {
        await runInTab(tab.id, (token) => {
          for (const element of document.querySelectorAll('*')) {
            const position = getComputedStyle(element).position;
            if (position === 'fixed' || position === 'sticky') {
              element.setAttribute('data-full-page-capture-hidden', token);
            }
          }
        }, [hideToken]);
      }

      // Infinite/lazy pages may grow while we scroll; refresh its real height.
      // The scroll step already waited 550ms before capture, so avoid a second full delay.
      if (captureCancelRequested) throw new Error('Capture cancelled.');
      const currentHeight = await runInTab(tab.id, () => Math.max(
        document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0,
      ));
      metrics.height = Math.max(metrics.height, currentHeight);
      targetY = Math.min(actualY + metrics.viewportHeight, Math.max(0, metrics.height - metrics.viewportHeight));
      reachedBottomOnce = targetY === actualY;
    }
  } finally {
    // Never leave the user at the bottom of their page, including after a failure.
    try {
      await runInTab(tab.id, (y, token) => {
        document.getElementById(`full-page-capture-style-${token}`)?.remove();
        document.querySelectorAll(`[data-full-page-capture-hidden="${token}"]`).forEach((element) => {
          element.removeAttribute('data-full-page-capture-hidden');
        });
        window.scrollTo(0, y);
      }, [originalY, hideToken]);
    } catch { /* tab navigated */ }
  }

  if (format === 'png' || format === 'webp') {
    await downloadImage(captures, metrics, tab.title, format);
    return partialCapture
      ? `${format.toUpperCase()} downloaded (first ${MAX_CAPTURED_SECTIONS} loaded sections).`
      : `${format.toUpperCase()} downloaded.`;
  }
  await downloadPdf(captures, metrics, tab.title);
  return partialCapture
    ? `PDF downloaded (first ${MAX_CAPTURED_SECTIONS} loaded sections).`
    : 'PDF downloaded.';
}

async function runInTab(tabId, func, args = []) {
  const [result] = await chrome.scripting.executeScript({target: {tabId}, func, args});
  return result.result;
}

async function decodeImage(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

async function downloadImage(captures, metrics, title, format) {
  const first = await decodeImage(captures[0].dataUrl);
  const scale = first.width / metrics.viewportWidth;
  // Keep the document's exact height. Captures are positioned using their real scroll
  // offsets, so the final tile is cropped precisely at the bottom of the page.
  const totalHeight = Math.ceil(metrics.height * scale);
  const baseName = safeFileName(title || 'full-page');
  // A PNG must be a single canvas. Downscale only when the page exceeds Chromium's
  // maximum canvas height; PDF remains available when the original resolution matters.
  const maximumHeight = format === 'webp' ? MAX_WEBP_HEIGHT : MAX_PNG_HEIGHT;
  const outputScale = Math.min(1, maximumHeight / totalHeight);
  const outputWidth = Math.max(1, Math.round(first.width * outputScale));
  const outputHeight = Math.max(1, Math.round(totalHeight * outputScale));

  try {
    const canvas = new OffscreenCanvas(outputWidth, outputHeight);
    const context = canvas.getContext('2d');
    for (const capture of captures) {
      const image = capture === captures[0] ? first : await decodeImage(capture.dataUrl);
      const y = Math.round(capture.y * scale * outputScale);
      const imageHeight = Math.round(image.height * outputScale);
      if (y < outputHeight && y + imageHeight > 0) {
        context.drawImage(image, 0, y, outputWidth, imageHeight);
      }
      if (image !== first) image.close();
    }
    const type = format === 'webp' ? 'image/webp' : 'image/png';
    const options = format === 'webp' ? {type, quality: 0.82} : {type};
    const dataUrl = await blobToDataUrl(await canvas.convertToBlob(options));
    await chrome.downloads.download({url: dataUrl, filename: `${baseName}.${format}`, saveAs: false});
  } finally {
    first.close();
  }
}

async function downloadPdf(captures, metrics, title) {
  const first = await decodeImage(captures[0].dataUrl);
  const scale = first.width / metrics.viewportWidth;
  const fullHeight = Math.ceil(metrics.height * scale);
  const outputScale = Math.min(1, MAX_PNG_HEIGHT / fullHeight);
  const outputWidth = Math.max(1, Math.round(first.width * outputScale));
  const outputHeight = Math.max(1, Math.round(fullHeight * outputScale));

  let jpeg;
  try {
    const canvas = new OffscreenCanvas(outputWidth, outputHeight);
    const context = canvas.getContext('2d');
    for (const capture of captures) {
      const image = capture === captures[0] ? first : await decodeImage(capture.dataUrl);
      const y = Math.round(capture.y * scale * outputScale);
      const imageHeight = Math.round(image.height * outputScale);
      if (y < outputHeight && y + imageHeight > 0) {
        context.drawImage(image, 0, y, outputWidth, imageHeight);
      }
      if (image !== first) image.close();
    }
    jpeg = new Uint8Array(await (await canvas.convertToBlob({type: 'image/jpeg', quality: 0.85})).arrayBuffer());
  } finally {
    first.close();
  }

  const dataUrl = await blobToDataUrl(new Blob([makePdf([{width: outputWidth, height: outputHeight, jpeg}])], {type: 'application/pdf'}));
  await chrome.downloads.download({url: dataUrl, filename: `${safeFileName(title || 'full-page')}.pdf`, saveAs: false});
}

// A small, dependency-free PDF writer. The complete page is one PDF page.
function makePdf(pages) {
  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [0];
  let length = 0;
  const push = (part) => { const bytes = typeof part === 'string' ? encoder.encode(part) : part; parts.push(bytes); length += bytes.length; };
  const object = (number, body) => { offsets[number] = length; push(`${number} 0 obj\n`); push(body); push('\nendobj\n'); };

  push('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');
  const pageObjectStart = 3;
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObjectStart + i * 3} 0 R`).join(' ')}] >>`);
  pages.forEach((page, i) => {
    const pageObject = pageObjectStart + i * 3;
    const contentObject = pageObject + 1;
    const imageObject = pageObject + 2;
    // PDF viewers commonly limit a physical page edge to 200 inches (14,400 points).
    // Scale down only when necessary, keeping the page whole rather than splitting it.
    const heightAtStandardWidth = Math.round(612 * page.height / page.width);
    const height = Math.min(14_400, Math.max(1, heightAtStandardWidth));
    const width = Math.max(1, Math.round(height * page.width / page.height));
    object(pageObject, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`);
    const content = `q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`;
    object(contentObject, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
    offsets[imageObject] = length;
    push(`${imageObject} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`);
    push(page.jpeg);
    push('\nendstream\nendobj\n');
  });
  const xref = length;
  push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let i = 1; i < offsets.length; i += 1) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, {type: 'application/pdf'});
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

function safeFileName(value) {
  return value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100) || 'full-page';
}
