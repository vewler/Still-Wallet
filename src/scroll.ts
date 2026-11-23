/** Smooth scroll that can't be interrupted or stacked. Wheel, touch and scroll keys are ignored while it runs. */
let running: { cancel: () => void } | null = null

const keys = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar'])
const block = (event: Event) => event.preventDefault()
const blockKeys = (event: KeyboardEvent) => { if (keys.has(event.key)) event.preventDefault() }

function lockInput() {
  addEventListener('wheel', block, { passive: false })
  addEventListener('touchmove', block, { passive: false })
  addEventListener('keydown', blockKeys, { passive: false })
  document.documentElement.classList.add('is-auto-scrolling')
}

function unlockInput() {
  removeEventListener('wheel', block)
  removeEventListener('touchmove', block)
  removeEventListener('keydown', blockKeys)
  document.documentElement.classList.remove('is-auto-scrolling')
}

const ease = (t: number) => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2

/** Scrolls so the element sits just under the sticky header. */
export function smoothScrollTo(target: HTMLElement | number, onDone?: () => void) {
  running?.cancel()
  const header = document.querySelector<HTMLElement>('.landing-header')?.offsetHeight ?? 0
  const max = document.documentElement.scrollHeight - innerHeight
  const goal = Math.max(0, Math.min(max, typeof target === 'number' ? target : target.getBoundingClientRect().top + scrollY - header - 16))
  const start = scrollY
  const distance = goal - start
  if (Math.abs(distance) < 2) { scrollTo(0, goal); onDone?.(); return }
  // Same duration whatever the distance.
  const duration = 800
  const began = performance.now()
  let frame = 0
  let safety = 0
  lockInput()
  const finish = () => { cancelAnimationFrame(frame); clearTimeout(safety); unlockInput(); running = null }
  running = { cancel: finish }
  // If frames stop (hidden tab, slow device), jump to the end.
  safety = window.setTimeout(() => { finish(); scrollTo(0, goal); onDone?.() }, duration + 400)
  const step = (now: number) => {
    const progress = Math.min(1, (now - began) / duration)
    scrollTo(0, start + distance * ease(progress))
    if (progress < 1) frame = requestAnimationFrame(step)
    else { finish(); onDone?.() }
  }
  frame = requestAnimationFrame(step)
}
