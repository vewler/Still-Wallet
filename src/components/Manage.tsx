import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { GripVertical, Minus, Plus } from 'lucide-react'
import { arrangeAssets, arrangeList, defaultLayout, type Asset, type AssetLayout } from '../assets'
import type { Environment } from '../networks'
import { networks } from '../networks'
import { Coin, TokenIcon } from './Icons'
import { Dialog } from './Dialog'

function AssetIcon({ asset }: { asset: Asset }) {
  return asset.token ? <TokenIcon token={asset.token} /> : <Coin chain={asset.chain} />
}

/** FLIP: moved rows glide to their new spot, new rows fade/scale in. */
function useFlip(root: RefObject<HTMLElement | null>, paused = false) {
  const last = useRef(new Map<string, { top: number; height: number }>())
  // Rows that switch lists remount, that's how a removal is told apart from closing a gap.
  const seen = useRef(new WeakSet<Element>())
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    // Measure inside the list, ignoring slides in progress.
    const measure = () => {
      const origin = element.getBoundingClientRect().top
      return new Map([...element.querySelectorAll<HTMLElement>('[data-flip]')].map((row) => {
        // While dragging keep drawn positions so the drop settles from there.
        const transform = paused ? 'none' : getComputedStyle(row).transform
        const sliding = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42
        const box = row.getBoundingClientRect()
        return [row.dataset.flip!, { top: box.top - origin - sliding, height: box.height }]
      }))
    }
    // The sheet opens right after this first runs (everything measures 0). Take start positions once it's visible.
    if (!element.getClientRects().length) {
      const frame = requestAnimationFrame(() => {
        last.current = measure()
        for (const row of element.querySelectorAll('[data-flip]')) seen.current.add(row)
      })
      return () => cancelAnimationFrame(frame)
    }
    const next = measure()
    for (const row of element.querySelectorAll<HTMLElement>('[data-flip]')) {
      const rect = next.get(row.dataset.flip!)!
      const before = last.current.get(row.dataset.flip!)
      // Dragging: rows move by inline transforms, just record them.
      if (paused) continue
      // Card backgrounds animate to their new size/position.
      if (row.dataset.scale !== undefined) {
        if (before && rect.height && (Math.abs(before.top - rect.top) > 0.5 || Math.abs(before.height - rect.height) > 0.5)) {
          row.animate([{ transform: `translateY(${before.top - rect.top}px) scaleY(${before.height / rect.height})` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.3,1.1,.4,1)' })
        }
        continue
      }
      // "Add tokens" fades out and back in at its new spot.
      if (row.dataset.fade !== undefined) {
        if (before && Math.abs(before.top - rect.top) > 0.5) {
          const ghost = row.cloneNode(true) as HTMLElement
          ghost.removeAttribute('data-flip')
          Object.assign(ghost.style, { position: 'absolute', margin: '0', left: `${row.offsetLeft}px`, top: `${row.offsetTop + before.top - rect.top}px`, width: `${row.offsetWidth}px`, pointerEvents: 'none' })
          row.parentElement!.appendChild(ghost)
          ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 80, easing: 'ease-out', fill: 'forwards' }).onfinish = () => ghost.remove()
          // Fade the title in once the cards have nearly settled.
          row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 130, delay: 90, easing: 'ease-out', fill: 'backwards' })
        }
        continue
      }
      if (!before) {
        if (last.current.size) row.animate([{ transform: 'translateY(-12px) scale(.97)' }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.3,1.2,.5,1)' })
      } else if (Math.abs(before.top - rect.top) > 0.5) {
        // A removed coin fades into place in the other list, no sliding past the label.
        if (!seen.current.has(row) && row.matches('button')) {
          row.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.3,1.1,.4,1)' })
          continue
        }
        // Everything else slides with the same timing.
        row.animate([{ transform: `translateY(${before.top - rect.top}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.3,1.1,.4,1)' })
      }
    }
    last.current = next
    for (const row of element.querySelectorAll('[data-flip]')) seen.current.add(row)
  })
}

const where = (asset: Asset) => asset.token ? `${asset.name} · ${networks[asset.network].name}` : asset.symbol

/** Choose which coins show on Home and in what order. Saved per wallet. */
export function ManageCoins({ environment, layout, save, close, assets, title = 'Manage tokens', defaults = defaultLayout, place = 'on Home' }: {
  environment: Environment; layout: AssetLayout; save: (layout: AssetLayout) => void; close: () => void
  /** Custom list (Charts uses one per coin). Defaults to every Home coin. */
  assets?: Asset[]; title?: string; defaults?: AssetLayout; place?: string
}) {
  const arranged = assets ? arrangeList(assets, layout) : arrangeAssets(environment, layout)
  const [order, setOrder] = useState(() => arranged.filter((entry) => entry.shown).map((entry) => entry.asset))
  const hidden = arranged.filter((entry) => !order.some((asset) => asset.id === entry.asset.id)).map((entry) => entry.asset)
  const [drag, setDrag] = useState<{ id: string; from: number; startY: number; dy: number; step: number }>()
  const list = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  useFlip(body, !!drag)
  const target = drag ? Math.max(0, Math.min(order.length - 1, drag.from + Math.round(drag.dy / drag.step))) : -1

  function commit(next: Asset[]) {
    setOrder(next)
    const shown = next.map((asset) => asset.id)
    save({ order: [...shown, ...arranged.map((entry) => entry.asset.id).filter((id) => !shown.includes(id))], shown })
  }

  const move = (index: number, offset: number) => {
    const target = index + offset
    if (target < 0 || target >= order.length) return
    const next = [...order]
    ;[next[index], next[target]] = [next[target], next[index]]
    commit(next)
  }

  // Drag by the grip (mouse or touch). Other rows slide aside live; on release save and FLIP into place.
  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const rows = [...(list.current?.querySelectorAll<HTMLElement>('[data-asset]') ?? [])]
    const step = rows.length > 1 ? rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top : rows[0]?.offsetHeight ?? 58
    setDrag({ id, from: order.findIndex((asset) => asset.id === id), startY: event.clientY, dy: 0, step: step || 58 })
    // No text selection (or its autoscroll) during a drag.
    document.documentElement.classList.add('is-reordering')
  }
  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!drag) return
    event.preventDefault()
    // Clamp to the first/last slot.
    const min = -drag.from * drag.step
    const max = (order.length - 1 - drag.from) * drag.step
    setDrag({ ...drag, dy: Math.max(min, Math.min(max, event.clientY - drag.startY)) })
  }
  function endDrag() {
    document.documentElement.classList.remove('is-reordering')
    if (!drag) return
    const next = [...order]
    const [moved] = next.splice(drag.from, 1)
    next.splice(target, 0, moved)
    setDrag(undefined)
    if (target !== drag.from) commit(next)
  }
  // Live on-screen order during a drag, for the dividers.
  const visual = (index: number) => !drag ? index : index === drag.from ? target : index + shift(index) / drag.step
  const shift = (index: number) => {
    if (!drag || index === drag.from) return 0
    if (drag.from < target && index > drag.from && index <= target) return -drag.step
    if (drag.from > target && index >= target && index < drag.from) return drag.step
    return 0
  }

  return <Dialog title={title} close={close}>
    <div ref={body} className="manage-body">
    <p className="group-label manage-label" data-flip="label-shown">{place[0].toUpperCase() + place.slice(1)} · drag to reorder</p>
    <div className="group manage-list" ref={list}>
      <span className="manage-bg" data-flip="bg-shown" data-scale aria-hidden="true" />
      {/* Always mounted and fading, so the empty card keeps one row of height and add/remove animate the same. */}
      <p className={order.length ? 'manage-empty' : 'manage-empty shown'} aria-hidden={order.length > 0}>No tokens {place}. Add some below.</p>
      {order.map((asset, index) => <div key={asset.id} data-asset={asset.id} data-flip={asset.id} className={`row manage-row${drag?.id === asset.id ? ' is-dragging' : ''}${drag ? ' is-sorting' : ''}${drag && drag.id !== asset.id && visual(index) > 0 ? ' divider' : ''}`}
        style={drag ? { transform: drag.id === asset.id ? `translateY(${drag.dy}px) scale(1.02)` : `translateY(${shift(index)}px)` } : undefined}>
        <button type="button" className="grip" aria-label={`Drag to reorder ${asset.symbol}. Arrow keys move it.`} onKeyDown={(event) => {
          // Arrow keys on the grip reorder.
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); move(index, event.key === 'ArrowUp' ? -1 : 1) }
        }} onPointerDown={(event) => startDrag(event, asset.id)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}><GripVertical size={18} /></button>
        <AssetIcon asset={asset} />
        <span className="row-text"><strong>{asset.token ? asset.symbol : asset.name}</strong><small>{where(asset)}</small></span>
        <span className="manage-actions">
          <button type="button" className="icon-button small manage-remove" aria-label={`Hide ${asset.symbol}`} onClick={() => commit(order.filter((entry) => entry.id !== asset.id))}><Minus size={17} /></button>
        </span>
      </div>)}
    </div>
    {hidden.length > 0 && <>
      <p className="group-label manage-label" data-flip="label-add" data-fade>Add tokens</p>
      <div className="group manage-list">
        <span className="manage-bg" data-flip="bg-add" data-scale aria-hidden="true" />
        {hidden.map((asset) => <button type="button" key={asset.id} data-flip={asset.id} className="row manage-row" onClick={() => commit([...order, asset])}>
          <AssetIcon asset={asset} />
          <span className="row-text"><strong>{asset.token ? asset.symbol : asset.name}</strong><small>{where(asset)}</small></span>
          <span className="manage-add"><Plus size={17} /></span>
        </button>)}
      </div>
    </>}
    </div>
    <button type="button" className="button text-button wide" onClick={() => { const next = (assets ? arrangeList(assets, defaults) : arrangeAssets(environment, defaults)).filter((entry) => entry.shown).map((entry) => entry.asset); commit(next) }}>Reset to default</button>
  </Dialog>
}
