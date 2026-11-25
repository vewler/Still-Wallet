import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export type PickerOption<T extends string | number> = { value: T; label: string; sub?: string; icon?: ReactNode }

/** Custom <select>. The list floats over the content. */
/** `search`: placeholder for a filter box at the top of the list, for long lists. */
export function Picker<T extends string | number>({ value, options, onChange, label, compact = false, search, empty = 'Nothing found' }: {
  value: T; options: PickerOption<T>[]; onChange: (value: T) => void; label: string; compact?: boolean; search?: string; empty?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const float = useRef<HTMLDivElement>(null)
  // Every word must match the name or the line under it, so "usdc sol" finds USDC on Solana.
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  // Exact name matches first, then names that start with a term, then the rest, each in list order.
  const rank = (option: PickerOption<T>) => { const name = option.label.toLowerCase(); return terms.includes(name) ? 0 : terms.some((term) => name.startsWith(term)) ? 1 : 2 }
  const shownOptions = terms.length ? options.filter((option) => terms.every((term) => `${option.label} ${option.sub ?? ''}`.toLowerCase().includes(term)))
    .map((option, index) => ({ option, index, rank: rank(option) })).sort((left, right) => left.rank - right.rank || left.index - right.index).map(({ option }) => option) : options
  const [active, setActive] = useState(0)
  // Only arrow keys highlight, touch has no hover.
  const [keyed, setKeyed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const [place, setPlace] = useState<CSSProperties>()
  // Stay mounted briefly so it can fade out.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (open) { setShown(true); return }
    const timer = window.setTimeout(() => setShown(false), 150)
    return () => window.clearTimeout(timer)
  }, [open])
  const selected = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !float.current?.contains(target)) setOpen(false)
    }
    // Position is computed once, so close on scroll/resize. Not while typing a search: a phone keyboard resizes and scrolls.
    const dismiss = (event: Event) => { if (!float.current?.contains(event.target as Node) && document.activeElement !== field.current) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [open])

  // Portaled (into the open sheet, since sheets are top layer) so nothing clips it. Opens below, or above if there's no room, clamped to the screen.
  useLayoutEffect(() => {
    if (!open || !button.current) return
    const rect = button.current.getBoundingClientRect()
    const width = Math.max(rect.width, 140)
    // Full height incl. border so a list that fits never scrolls by a pixel.
    const extra = search ? 56 : 0
    const height = (list.current ? list.current.scrollHeight + list.current.offsetHeight - list.current.clientHeight : options.length * 48 + 14) + extra
    const room = { below: window.innerHeight - rect.bottom - 14, above: rect.top - 14 }
    // Below if it fits or has more room, otherwise hang above from the button's top edge.
    const below = room.below >= height || room.below >= room.above
    setPlace({
      position: 'fixed',
      ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }),
      left: Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8),
      width,
      ['--picker-max' as string]: `${Math.max(120, Math.min(height, below ? room.below : room.above) - extra)}px`,
    })
  }, [open, options.length, search])

  // With a search, the list shrinks to fit the results (rows keep their size, stacked from the top) and grows back, animated.
  const fitted = useRef(false)
  useLayoutEffect(() => {
    const element = list.current
    if (!open || !search || !place || !element) { fitted.current = false; return }
    // No results: keep the last size, the empty note sits in the middle of it.
    if (!shownOptions.length) return
    const rows = [...element.children] as HTMLElement[]
    const gap = parseFloat(getComputedStyle(element).rowGap) || 0
    const content = rows.reduce((sum, row) => sum + row.offsetHeight, 0) + gap * Math.max(0, rows.length - 1)
    const max = parseFloat(String((place as Record<string, unknown>)['--picker-max'])) || content
    element.style.transition = fitted.current ? '' : 'none'
    element.style.height = `${Math.min(content, max)}px`
    fitted.current = true
  }, [open, search, place, shownOptions.length])

  // Focus the search on desktop once the list is placed (hidden until then). On touch it would pop the keyboard over the list.
  const placed = Boolean(place)
  useEffect(() => {
    if (open && placed && search && window.matchMedia('(pointer: fine)').matches) field.current?.focus({ preventScroll: true })
  }, [open, placed, search])

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  function show() {
    setQuery('')
    setActive(Math.max(0, options.findIndex((option) => option.value === value)))
    setKeyed(false)
    setOpen(true)
  }
  function choose(index: number) {
    const option = shownOptions[index]
    if (!option) return
    onChange(option.value)
    setOpen(false)
    if (document.activeElement === field.current) button.current?.focus({ preventScroll: true })
  }
  function keys(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus({ preventScroll: true }); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) { show(); setKeyed(true); return }
      setKeyed(true)
      if (!shownOptions.length) return
      setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + shownOptions.length) % shownOptions.length)
    } else if ((event.key === 'Enter' || (event.key === ' ' && event.target !== field.current)) && open) {
      event.preventDefault()
      choose(active)
    } else if (event.key === 'Tab') setOpen(false)
  }

  return <div ref={root} className={`picker${compact ? ' picker--compact' : ''}${open ? ' open' : ''}`}>
    <button ref={button} type="button" className="picker-button" aria-label={`${label}: ${selected.label}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={id}
      onClick={() => open ? setOpen(false) : show()} onKeyDown={keys}>
      {selected.icon}<span className="picker-text"><strong>{selected.label}</strong>{selected.sub && !compact && <small>{selected.sub}</small>}</span>
      <ChevronDown size={compact ? 15 : 18} className="picker-chevron" />
    </button>
    {(open || shown) && createPortal(<div ref={float} className={`picker-float${compact ? ' picker--compact' : ''}${search ? ' picker-float--search' : ''}${open ? '' : ' closing'}`} style={place ?? { position: 'fixed', visibility: 'hidden' }}>
      {search && <input ref={field} className="picker-search" type="search" placeholder={search} aria-label={search} aria-controls={id} value={query} onKeyDown={keys}
        onChange={(event) => { setQuery(event.target.value); setActive(0); setKeyed(event.target.value.trim() !== '') }} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="go" />}
      {menuList()}
    </div>, button.current?.closest('dialog') ?? document.body)}
  </div>

  function menuList() {
    return <ul ref={list} id={id} className="picker-list" style={search && !shownOptions.length ? { alignContent: 'center' } : undefined} role="listbox" aria-label={label} tabIndex={-1}>
      {shownOptions.map((option, index) => <li key={String(option.value)} role="option" aria-selected={option.value === value}
        className={keyed && index === active ? 'active' : undefined} onClick={() => choose(index)}>
        {option.icon}<span className="picker-text"><strong>{option.label}</strong>{option.sub && <small>{option.sub}</small>}</span>
        {option.value === value && <Check size={16} className="picker-check" />}
      </li>)}
      {search && !shownOptions.length && <li className="picker-empty" role="presentation">{empty}</li>}
    </ul>
  }
}
