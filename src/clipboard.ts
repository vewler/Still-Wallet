const clearAfter = 60_000
let clearTimer = 0
let wipePending = false

function stopWipe() {
  window.clearTimeout(clearTimer)
  wipePending = false
  window.removeEventListener('focus', retry)
  document.removeEventListener('visibilitychange', retry)
  document.removeEventListener('copy', stopWipe)
}

// The clipboard can only be written while the page has focus, so a missed wipe runs when Still is back.
function retry() {
  if (!wipePending || document.visibilityState !== 'visible') return
  void navigator.clipboard.writeText('').then(stopWipe, () => {})
}

/** Copy something secret and wipe it after a minute, unless something newer was copied in Still first. */
export function copySecret(text: string) {
  stopWipe()
  clearTimer = window.setTimeout(() => {
    wipePending = true
    window.addEventListener('focus', retry)
    document.addEventListener('visibilitychange', retry)
    retry()
  }, clearAfter)
  // Copying text by hand in Still replaces the secret, so the wipe isn't needed then.
  document.addEventListener('copy', stopWipe)
  return navigator.clipboard.writeText(text)
}

/** Copy plain text. Replaces any secret, so a pending wipe would only erase this. */
export function copyText(text: string) {
  stopWipe()
  return navigator.clipboard.writeText(text)
}
