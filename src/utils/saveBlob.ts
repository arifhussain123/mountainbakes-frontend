/**
 * Hand a generated file to the browser's download machinery.
 *
 * Two details here are what make it work on Safari, iPhone included:
 *
 *  - The anchor is IN the document when it is clicked. A detached anchor's
 *    click is honoured by Chrome and ignored by some WebKit builds.
 *  - The blob URL is revoked LATER, not on the next line. `click()` only queues
 *    the download; Safari reads the blob after this function has returned, and
 *    a URL revoked by then is a download that silently never starts. A minute
 *    is far longer than the read takes and costs nothing — the blob is freed
 *    then instead of now.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
