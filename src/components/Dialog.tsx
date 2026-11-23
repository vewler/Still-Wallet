import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type InputHTMLAttributes } from 'react'
import { X } from 'lucide-react'

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
export function Dialog({ title, close, busy = false, step, back = false, children }: {
  title: string; close: () => void; busy?: boolean; step?: string; back?: boolean; children: ReactNode
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
  const drag = useRef<{ y: number; time: number; dy: number; v: number } | null>(null)
  function dragStart(event: ReactPointerEvent) {
    if (busy || document.documentElement.dataset.layout !== 'phone' || (event.target as HTMLElement).closest('button')) return
    drag.current = { y: event.clientY, time: event.timeStamp, dy: 0, v: 0 }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    ref.current!.style.transition = 'none'
    ref.current!.classList.add('dragging-sheet')
    setDim(1)
  }
  function dragMove(event: ReactPointerEvent) {
    const state = drag.current
    if (!state) return
    const raw = event.clientY - state.y
    // Rubber-band when pulled up.
    const dy = raw > 0 ? raw : raw / 6
    state.v = (dy - state.dy) / Math.max(1, event.timeStamp - state.time)
    state.dy = dy
    state.time = event.timeStamp
    const dialog = ref.current!
    dialog.style.transform = `translateY(${dy}px)`
    // Backdrop stays fully dim for the first half of the pull.
    const half = dialog.getBoundingClientRect().height / 2
    setDim(Math.min(1, Math.max(0, 2 - Math.max(0, dy) / half)))
  }
  function dragEnd() {
    const state = drag.current
    if (!state) return
    drag.current = null
    const dialog = ref.current!
    dialog.style.transition = 'transform .28s cubic-bezier(.2, .8, .2, 1)'
    if (state.dy > dialog.getBoundingClientRect().height * 0.3 || (state.dy > 24 && state.v > 0.6)) {
      dialog.style.transform = 'translateY(100%)'
      setDim(0, '.28s')
      window.setTimeout(() => { setDim(null); close() }, 280)
    } else {
      dialog.style.transform = ''
      setDim(1, '.28s')
      window.setTimeout(() => { dialog.classList.remove('dragging-sheet'); setDim(null) }, 300)
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

  return <dialog ref={ref} className="dialog" tabIndex={-1} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); dismiss() }}
    onClick={(event) => {
      if (event.target !== ref.current || busy) return
      const rect = ref.current!.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss()
    }}>
    <div className="dialog-content">
      <div className="sheet-grab" onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd}>
      <div className="sheet-handle" />
      <div className="dialog-head"><h2 id={titleId} key={title} className="dialog-title">{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={dismiss} disabled={busy}><X size={19} /></button></div>
      </div>
      <div ref={size} className="dialog-size">
        <div ref={measure} className="dialog-measure">
          <div key={paneKey} className={`dialog-pane${back ? ' dialog-pane--back' : ''}`}>{children}</div>
        </div>
      </div>
    </div>
  </dialog>
}

export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={error ? 'notice notice--error' : 'notice'} role={error ? 'alert' : undefined}>{error ? <span>{children}</span> : children}</p>
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
  return <Slot open={!!error} className="error-slot">{last.current && <Notice key={attempt} error={!!error}>{last.current}</Notice>}</Slot>
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
