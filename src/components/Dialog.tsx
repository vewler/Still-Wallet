import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type InputHTMLAttributes } from 'react'
import { X } from 'lucide-react'
import { t } from '../i18n'

// Backdrop dim during a drag. ::backdrop doesn't inherit custom props on older iOS Safari, so the drag writes to a shared style rule.
let dimRule: CSSStyleDeclaration | undefined
function setDim(opacity: number | null, speed = '0s') {
  if (!dimRule) {
    const style = document.head.appendChild(document.createElement('style'))
    const sheet = style.sheet!
    sheet.insertRule('.dialog.dragging-sheet::backdrop {}', 0)
    dimRule = (sheet.cssRules[0] as CSSStyleRule).style
  }
  if (opacity === null) { dimRule.removeProperty('opacity'); dimRule.removeProperty('transition'); return }
  dimRule.setProperty('opacity', String(opacity))
  dimRule.setProperty('transition', `opacity ${speed} ease-out`)
}

// Pin the page while a sheet is open. iOS Safari ignores overflow: hidden and scrolls when the keyboard opens, so fix the body and restore the scroll after.
let pageLocks = 0
let pageScroll = 0
function lockPage() {
  if (pageLocks++ > 0) return
  pageScroll = window.scrollY
  // Desktop honors overflow: hidden. Pinning there slid the page under the sticky header.
  if (document.documentElement.dataset.layout === 'desktop') document.documentElement.style.overflow = 'hidden'
  else Object.assign(document.body.style, { position: 'fixed', top: `-${pageScroll}px`, left: '0', right: '0' })
  // Safari paints the strip under the keyboard from theme-color, match the sheet gray.
  themeColor()?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#101013')
}
function unlockPage() {
  if (--pageLocks > 0) return
  if (document.body.style.position === 'fixed') {
    Object.assign(document.body.style, { position: '', top: '', left: '', right: '' })
    window.scrollTo(0, pageScroll)
  }
  document.documentElement.style.overflow = ''
  themeColor()?.setAttribute('content', pageTheme)
}
const themeColor = () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
const pageTheme = themeColor()?.content ?? '#09090b'

/** Modal sheet. When the title/step changes the content slides and the sheet resizes to fit. */
export function Dialog({ title, close, busy = false, step, back = false, lead, className, children }: {
  title: string; close: () => void; busy?: boolean; step?: string; back?: boolean; className?: string
  /** Optional header button on the left, opposite the X. */
  lead?: ReactNode; children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const measure = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const size = useRef<HTMLDivElement>(null)
  const paneKey = step ?? title

  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    // showModal() focuses the X and shows a focus ring, focus the sheet instead.
    if (document.activeElement?.closest('.dialog-head')) dialog.focus({ preventScroll: true })
    lockPage()
    return () => { dialog.close(); unlockPage() }
  }, [])

  // Phones: leave the keyboard to the browser. Scrolling to the field ourselves made the sheet overshoot.

  // Animated close for X, Esc and backdrop (slide on phones, fade on desktop).
  const closing = useRef(false)
  function dismiss() {
    if (busy || closing.current) return
    closing.current = true
    ref.current!.classList.add('dialog--closing')
    // Unmount once the sheet and backdrop are done.
    window.setTimeout(close, 280)
  }

  // Phones: drag the handle/header down to close. Snaps back on a short pull, closes on a long pull or a flick.
  // The drag only starts once the finger travels 8px, so a slightly shaky tap stays a tap.
  const drag = useRef<{ y: number; time: number; dy: number; v: number } | null>(null)
  const press = useRef<{ x: number; y: number } | null>(null)
  function dragStart(event: ReactPointerEvent) {
    if (busy || document.documentElement.dataset.layout !== 'phone' || (event.target as HTMLElement).closest('button, a, input, textarea, select, label, [role="button"]')) return
    press.current = { x: event.clientX, y: event.clientY }
  }
  function dragMove(event: ReactPointerEvent) {
    if (!drag.current) {
      const start = press.current
      if (!start) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (Math.hypot(dx, dy) < 8) return
      press.current = null
      // Sideways swipes are not a sheet drag.
      if (Math.abs(dx) > Math.abs(dy)) return
      // Start from here so the sheet doesn't jump by the 8px.
      drag.current = { y: event.clientY, time: event.timeStamp, dy: 0, v: 0 }
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      ref.current!.style.transition = 'none'
      ref.current!.classList.add('dragging-sheet')
      setDim(1)
      return
    }
    const state = drag.current
    const raw = event.clientY - state.y
    // Pulled up: stiff rubber band, tops out around 20px.
    const dy = raw > 0 ? raw : -10 * Math.log1p(-raw / 40)
    // Smoothed speed (px/ms) so one jittery sample doesn't decide the release.
    const elapsed = event.timeStamp - state.time
    if (elapsed > 0) state.v = .6 * ((dy - state.dy) / elapsed) + .4 * state.v
    state.dy = dy
    state.time = event.timeStamp
    const dialog = ref.current!
    dialog.style.transform = `translateY(${dy}px)`
    // Backdrop stays fully dim for the first half of the pull.
    const half = dialog.getBoundingClientRect().height / 2
    setDim(Math.min(1, Math.max(0, 2 - Math.max(0, dy) / half)))
  }
  function dragEnd(event: ReactPointerEvent) {
    press.current = null
    const state = drag.current
    if (!state) return
    // Finger held still before letting go: no flick.
    if (event.timeStamp - state.time > 90) state.v = 0
    drag.current = null
    const dialog = ref.current!
    const height = dialog.getBoundingClientRect().height
    // Flick down closes even on a short pull; flick up keeps it open even after a long one.
    const closes = state.v > .5 ? state.dy > 16 : state.v < -.3 ? false : state.dy > height * .3
    if (closes) {
      // Keep the finger's speed: the faster the flick, the quicker it leaves.
      const left = height - state.dy
      const time = Math.round(Math.max(160, Math.min(320, left / Math.max(state.v, 1.2))))
      dialog.style.transition = `transform ${time}ms cubic-bezier(.3, .7, .4, 1)`
      dialog.style.transform = 'translateY(100%)'
      dialog.classList.add('dialog--leaving')
      setDim(0, `${time}ms`)
      window.setTimeout(() => { setDim(null); close() }, time)
    } else {
      // Settle back smoothly.
      dialog.style.transition = 'transform .42s cubic-bezier(.22, 1, .36, 1)'
      dialog.style.transform = ''
      setDim(1, '.3s')
      window.setTimeout(() => { dialog.classList.remove('dragging-sheet'); setDim(null) }, 440)
    }
  }

  // Track content height so the sheet resizes smoothly. Set inside the observer (before paint) so no frame shows the old height.
  useLayoutEffect(() => {
    const element = measure.current!
    const box = size.current!
    let current = element.offsetHeight
    box.style.height = `${current}px`
    const observer = new ResizeObserver(() => {
      const next = element.offsetHeight
      // Small deltas come from a row that is already animating, follow them directly or the sheet lags and bounces.
      // The first real size arrives once showModal() runs (measured 0 before), so the sheet opens at full height instead of growing from 0.
      box.style.transition = current === 0 || Math.abs(next - current) < 24 ? 'none' : ''
      box.style.height = `${next}px`
      current = next
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return <dialog ref={ref} className={className ? `dialog ${className}` : 'dialog'} tabIndex={-1} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); dismiss() }}
    onClick={(event) => {
      if (event.target !== ref.current || busy) return
      const rect = ref.current!.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss()
    }}>
    <div className="dialog-content">
      <div className="sheet-grab" onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd}>
      <div className="sheet-handle" />
      <div className="dialog-head">{lead && <span className="dialog-lead">{lead}</span>}<h2 id={titleId} key={title} className="dialog-title">{title}</h2><button type="button" className="icon-button" aria-label={t('Close dialog')} onClick={dismiss} disabled={busy}><X size={19} /></button></div>
      </div>
      <div ref={size} className="dialog-size">
        <div ref={measure} className="dialog-measure">
          <div key={paneKey} className={`dialog-pane${back ? ' dialog-pane--back' : ''}`}>{children}</div>
        </div>
      </div>
    </div>
  </dialog>
}

export function Notice({ children, error = false, shake }: { children: ReactNode; error?: boolean; shake?: number }) {
  return <p className={error ? 'notice notice--error' : 'notice'} role={error ? 'alert' : undefined}>{error ? <span key={shake}>{children}</span> : children}</p>
}

/** Row that animates its height in and out. */
export function Slot({ open, children, className = '' }: { open: boolean; children: ReactNode; className?: string }) {
  const last = useRef(children)
  if (open) last.current = children
  const ref = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)
  // Same animation both ways, reversed.
  useLayoutEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    const element = ref.current!
    const full = { height: `${(element.firstElementChild as HTMLElement).offsetHeight}px`, marginTop: '0px', opacity: 1 }
    const empty = { height: '0px', marginTop: 'var(--slot-gap, -14px)', opacity: 0 }
    const animation = element.animate(open ? [empty, full] : [full, empty], { duration: 300, easing: 'cubic-bezier(.2, .8, .2, 1)' })
    return () => animation.cancel()
  }, [open])
  return <div ref={ref} className={`slot ${className}${open ? ' open' : ''}`} aria-hidden={!open} inert={!open}><div>{last.current}</div></div>
}

/** Text whose height animates when its length changes. */
export function Glide({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = ref.current!
    const inner = element.firstElementChild as HTMLElement
    let current = inner.offsetHeight
    const observer = new ResizeObserver(() => {
      const next = inner.offsetHeight
      if (next !== current) element.animate([{ height: `${current}px` }, { height: `${next}px` }], { duration: 300, easing: 'cubic-bezier(.2, .8, .2, 1)' })
      current = next
    })
    observer.observe(inner)
    return () => observer.disconnect()
  }, [])
  return <div ref={ref} className="glide"><div>{children}</div></div>
}

/** Animated error message. */
/** `attempt` bumps on every failure so the same message shakes again. */
export function ErrorSlot({ error, attempt = 0 }: { error: string; attempt?: number }) {
  const last = useRef(error)
  if (error) last.current = error
  // A repeat error keeps the same box and only re-shakes the text, so it never flashes.
  return <Slot open={!!error} className="error-slot">{last.current && <Notice error={!!error} shake={attempt}>{t(last.current)}</Notice>}</Slot>
}

/** Password field with fading dots. The real input keeps focus, caret and autofill; its glyphs are hidden and bullets drawn on top. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'autoComplete'> & { value: string }) {
  // Deleted dots linger so they can shrink out.
  const length = Array.from(props.value).length
  // Only drop the count once deleting pauses, so a dot never remounts mid-shrink.
  const [shown, setShown] = useState(length)
  // Backspace shrink is 90ms, 70ms when held (<200ms apart).
  const [held, setHeld] = useState(false)
  const last = useRef({ length, time: 0 })
  useLayoutEffect(() => {
    if (length >= last.current.length) { last.current = { length, time: 0 }; return }
    const now = performance.now()
    setHeld(now - last.current.time < 200)
    last.current = { length, time: now }
  }, [length])
  useLayoutEffect(() => {
    if (length >= shown) { setShown(length); return }
    const timer = window.setTimeout(() => setShown(length), held ? 70 : 90)
    return () => window.clearTimeout(timer)
  }, [length, shown, held])
  // Caret only when empty.
  return <span className={props.value ? 'pw-input pw-input--filled' : 'pw-input'}>
    {/* Plain text input masked with CSS so browsers and password managers never save or fill it. Copy is blocked. */}
    <input {...props} type="text" name="vault-key" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} data-1p-ignore data-lpignore="true" data-bwignore="true" data-form-type="other"
      onCopy={(event) => event.preventDefault()} onCut={(event) => event.preventDefault()} onDragStart={(event) => event.preventDefault()} />
    <span className="pw-dots" aria-hidden="true" style={{ '--dot-out': held ? '.07s' : '.09s' } as CSSProperties}>{Array.from({ length: Math.max(length, shown) }, (_, index) => <span key={index} className={index >= length ? 'pw-out' : undefined}>•</span>)}</span>
  </span>
}

/** Delay `open` a bit after a tile tap so the icon animation shows first. */
export function afterTap(open: () => void) {
  window.setTimeout(open, 300)
}
