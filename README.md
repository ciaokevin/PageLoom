# Full Page Capture

A lightweight Chrome extension that captures the entire current web page and downloads it as a single **PNG** or **PDF** file.

All capture, image processing, and file generation happen locally in the browser. Nothing is uploaded to an external service.

## Features

- Capture the full height of the active web page, not just the visible viewport.
- Download the result as a single PNG image.
- Download the result as a single, continuous PDF page.
- Preserve the page header in the first captured section while preventing fixed or sticky UI from repeating further down the image.
- Hide scrollbars during capture and restore them afterward.
- Restore the original scroll position when the capture finishes or fails.
- Wait for lazy-loaded content and page footers before completing the capture.
- Prevent duplicate captures while a capture is already running.
- Use a compact, dark English-language popup interface.
- Save files to Chrome's normal download location without requesting an additional file picker from the extension.

## Install locally

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** in the top-right corner.
4. Click **Load unpacked**.
5. Select the folder that contains `manifest.json`.
6. Open a page, click the extension icon, and choose **Download PNG** or **Download PDF**.

After changing source files, click the reload button on the extension card in `chrome://extensions`.

## How it works

1. The extension temporarily hides the page scrollbar.
2. It captures the first viewport with the header intact.
3. It hides fixed and sticky interface elements, then scrolls and captures the rest of the page.
4. It stitches the captured viewports into one continuous document.
5. It restores the page's original interface and scroll position.
6. It downloads the assembled PNG or PDF locally.

## Long pages

Browsers have a maximum canvas size. For exceptionally tall pages, the extension proportionally reduces the final output resolution so that PNG and PDF can still be exported as one complete image/page. No content is intentionally split into separate output files or PDF pages.

For the sharpest result on unusually long documents, use the PDF option.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `activeTab` | Access only the tab the user explicitly invokes the extension on. |
| `scripting` | Measure and scroll the page, and temporarily hide repeated UI elements. |
| `downloads` | Save the generated PNG or PDF to the local Downloads folder. |

The extension does not request broad host permissions such as `<all_urls>`.

## Privacy

- No analytics, tracking, authentication, or external API calls.
- No page content, screenshots, URLs, or browsing history are transmitted off the device.
- Processing occurs locally in Chrome and the final file is saved through Chrome's download system.

## Limitations

- Chrome internal pages such as `chrome://`, the Chrome Web Store, and some protected pages cannot be captured due to browser security restrictions.
- Page content that changes continuously during capture may not align perfectly.
- Infinite-scroll pages are limited to 250 viewport captures to avoid an endless operation.
- Fixed/sticky UI detected after the first viewport is hidden during the remaining capture. This prevents repeated navigation bars, chat widgets, and similar controls.
- Chrome's own download setting **Ask where to save each file before downloading** can still show a system save dialog. Disable it in `chrome://settings/downloads` for automatic saving.

## Project files

```text
manifest.json   Extension manifest and permissions
background.js   Capture, stitching, PDF generation, and download logic
popup.html      Extension popup markup
popup.css       Popup styling
popup.js        Popup interaction logic
```

## License

This project is licensed under the [MIT License](LICENSE).
