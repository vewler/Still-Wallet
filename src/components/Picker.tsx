import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export type PickerOption<T extends string | number> = { value: T; label: string; sub?: string; icon?: ReactNode }

/** Custom <select>. The list floats over the content. */
export function Picker<T extends string | number>({ value, options, onChange, label, compact = false }: {
  value: T; options: PickerOption<T>[]; onChange: (value: T) => void; label: string; compact?: boolean
}) {
  const [open, setOpen] = useState(false)
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
      if (!root.current?.contains(target) && !list.current?.contains(target)) setOpen(false)
    }
    // Position is computed once, so close on scroll/resize.
    const dismiss = (event: Event) => { if (!list.current?.contains(event.target as Node)) setOpen(false) }
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
    const height = list.current ? list.current.scrollHeight + list.current.offsetHeight - list.current.clientHeight : options.length * 48 + 14
    const room = { below: window.innerHeight - rect.bottom - 14, above: rect.top - 14 }
    // Below if it fits or has more room, otherwise hang above from the button's top edge.
    const below = room.below >= height || room.below >= room.above
    setPlace({
      position: 'fixed',
      ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }),
      left: Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8),
      width,
      ['--picker-max' as string]: `${Math.max(120, Math.min(height, below ? room.below : room.above))}px`,
    })
  }, [open, options.length])

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  function show() {
    setActive(Math.max(0, options.findIndex((option) => option.value === value)))
    setKeyed(false)
    setOpen(true)
  }
  function choose(index: number) {
    onChange(options[index].value)
    setOpen(false)
  }
  function keys(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) { show(); setKeyed(true); return }
      setKeyed(true)
      setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
    } else if ((event.key === 'Enter' || event.key === ' ') && open) {
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
    {(open || shown) && createPortal(<div className={`picker-float${compact ? ' picker--compact' : ''}${open ? '' : ' closing'}`} style={place ?? { position: 'fixed', visibility: 'hidden' }}>{menuList()}</div>, button.current?.closest('dialog') ?? document.body)}
  </div>

  function menuList() {
    return <ul ref={list} id={id} className="picker-list" role="listbox" aria-label={label} tabIndex={-1}>
      {options.map((option, index) => <li key={String(option.value)} role="option" aria-selected={option.value === value}
        className={keyed && index === active ? 'active' : undefined} onClick={() => choose(index)}>
        {option.icon}<span className="picker-text"><strong>{option.label}</strong>{option.sub && <small>{option.sub}</small>}</span>
        {option.value === value && <Check size={16} className="picker-check" />}
      </li>)}
    </ul>
  }
}
