import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { GripVertical, Minus, Plus, Search, Trash2, X } from 'lucide-react'
import { arrangeAssets, arrangeList, defaultLayout, popularAssets, type Asset, type AssetLayout } from '../assets'
import type { Environment } from '../networks'
import { networks } from '../networks'
import { Coin, TokenIcon } from './Icons'
import { Dialog } from './Dialog'
import { t } from '../i18n'

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

const where = (asset: Asset) => asset.token ? `${asset.name} · ${networks[asset.network].name}${asset.token.user && !asset.token.verified ? ` · ${t('Unverified')}` : ''}` : asset.symbol

type Drag = { id: string; from: number; startY: number; dy: number; step: number }

/** Choose which coins show on Home and in what order. Saved per wallet. */
export type TokenImports = {
  remove: (id: string) => void
}

export function ManageCoins({ environment, layout, save, close, assets, title = 'Manage tokens', defaults = defaultLayout, place = 'on Home', imports }: {
  environment: Environment; layout: AssetLayout; save: (layout: AssetLayout) => void; close: () => void
  /** Custom list (Charts uses one per coin). Defaults to every Home coin. */
  assets?: Asset[]; title?: string; defaults?: AssetLayout; place?: string
  /** Home only: search, remove imported tokens. */
  imports?: TokenImports
}) {
  const [query, setQuery] = useState('')
  // Keep the sheet's height while searching so it doesn't jump as results shrink.
  // Only hold what's on screen, anything taller just scrolled into empty space.
  const [held, setHeld] = useState<number>()
  function search(value: string) {
    if (value.trim() && held === undefined && body.current) {
      const element = body.current
      let scroller = element.parentElement
      while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
      const overflow = scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0
      setHeld(Math.max(0, element.offsetHeight - overflow))
    }
    if (!value.trim()) setHeld(undefined)
    setQuery(value)
  }
  const arranged = assets ? arrangeList(assets, layout) : arrangeAssets(environment, layout)
  const [order, setOrder] = useState(() => arranged.filter((entry) => entry.shown).map((entry) => entry.asset))
  const hidden = arranged.filter((entry) => !order.some((asset) => asset.id === entry.asset.id)).map((entry) => entry.asset)
  const [drag, setDrag] = useState<Drag>()
  // Handlers read the live drag from here. A quick press can fire pointerup before React re-renders, which left a row stuck lifted.
  const dragging = useRef<Drag>(undefined)
  const updateDrag = (next: Drag | undefined) => { dragging.current = next; setDrag(next) }
  const list = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  useFlip(body, !!drag)
  // Search by ticker, name or network. Home only.
  const needle = imports ? query.trim().toLowerCase() : ''
  const matches = (asset: Asset) => !needle || [asset.symbol, asset.name, networks[asset.network]?.name].some((text) => text?.toLowerCase().includes(needle))
  const foundShown = order.filter(matches)
  // Home without a search: only popular coins and the user's own tokens. Search finds the rest.
  const popular = (asset: Asset) => !!asset.token?.user || popularAssets.includes(asset.id)
  const rank = (asset: Asset) => { const index = popularAssets.indexOf(asset.id); return index === -1 ? popularAssets.length : index }
  const shortList = !!imports && !needle
  // Imported tokens always come first.
  const imported = (asset: Asset) => asset.token?.user === 'custom'
  const importedFirst = (a: Asset, b: Asset) => Number(imported(b)) - Number(imported(a))
  const foundHidden = shortList ? hidden.filter(popular).sort((a, b) => importedFirst(a, b) || rank(a) - rank(b)) : hidden.filter(matches).sort(importedFirst)
  const slot = (current: Drag) => Math.max(0, Math.min(order.length - 1, current.from + Math.round(current.dy / current.step)))
  const target = drag ? slot(drag) : -1

  function commit(next: Asset[]) {
    setOrder(next)
    const shown = next.map((asset) => asset.id)
    save({ order: [...shown, ...arranged.map((entry) => entry.asset.id).filter((id) => !shown.includes(id))], shown })
  }

  const move = (index: number, offset: number) => {
    if (needle) return
    const target = index + offset
    if (target < 0 || target >= order.length) return
    const next = [...order]
    ;[next[index], next[target]] = [next[target], next[index]]
    commit(next)
  }

  // Drag by the grip (mouse or touch). Other rows slide aside live; on release save and FLIP into place.
  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    event.preventDefault()
    if (needle) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const rows = [...(list.current?.querySelectorAll<HTMLElement>('[data-asset]') ?? [])]
    const step = rows.length > 1 ? rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top : rows[0]?.offsetHeight ?? 58
    updateDrag({ id, from: order.findIndex((asset) => asset.id === id), startY: event.clientY, dy: 0, step: step || 58 })
    // No text selection (or its autoscroll) during a drag.
    document.documentElement.classList.add('is-reordering')
  }
  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = dragging.current
    if (!current) return
    event.preventDefault()
    // Clamp to the first/last slot.
    const min = -current.from * current.step
    const max = (order.length - 1 - current.from) * current.step
    updateDrag({ ...current, dy: Math.max(min, Math.min(max, event.clientY - current.startY)) })
  }
  // Release, cancel, lost capture or focus moving to search all drop the row where it is.
  function endDrag() {
    document.documentElement.classList.remove('is-reordering')
    const current = dragging.current
    if (!current) return
    const to = slot(current)
    const next = [...order]
    const [moved] = next.splice(current.from, 1)
    next.splice(to, 0, moved)
    updateDrag(undefined)
    if (to !== current.from) commit(next)
  }
  // Live on-screen order during a drag, for the dividers.
  const visual = (index: number) => !drag ? index : index === drag.from ? target : index + shift(index) / drag.step
  const shift = (index: number) => {
    if (!drag || index === drag.from) return 0
    if (drag.from < target && index > drag.from && index <= target) return -drag.step
    if (drag.from > target && index >= target && index < drag.from) return drag.step
    return 0
  }

  return <Dialog title={t(title)} step="list" close={close}>
    {imports && <label className="field manage-search">
      <Search size={18} aria-hidden="true" />
      <input value={query} onChange={(event) => search(event.target.value)} onFocus={endDrag} placeholder={t('Search tokens')} aria-label={t('Search tokens')} name="token-search" type="text" inputMode="search" enterKeyHint="search"
        autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} maxLength={40} data-1p-ignore data-lpignore="true" data-bwignore="true" data-form-type="other" onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
      {query && <button type="button" className="manage-search-clear" aria-label={t('Clear search')} onClick={() => search('')}><X size={16} /></button>}
    </label>}
    <div ref={body} className="manage-body" style={needle && held ? { minHeight: held, alignContent: 'start' } : undefined}>
    {needle && !foundShown.length && !foundHidden.length && <p className="manage-none">{t('No tokens found')}</p>}
    {(!needle || foundShown.length > 0) && <>
    <p className="group-label manage-label" data-flip="label-shown">{place === 'in Charts' ? t('In Charts · drag to reorder') : t('On Home · drag to reorder')}</p>
    <div className={needle ? 'group manage-list is-searching' : 'group manage-list'} ref={list}>
      <span className="manage-bg" data-flip="bg-shown" data-scale aria-hidden="true" />
      {/* Always mounted and fading, so the empty card keeps one row of height and add/remove animate the same. */}
      <p className={order.length ? 'manage-empty' : 'manage-empty shown'} aria-hidden={order.length > 0}>{place === 'in Charts' ? t('No tokens in Charts. Add some below.') : t('No tokens on Home. Add some below.')}</p>
      {order.map((asset, index) => matches(asset) && <div key={asset.id} data-asset={asset.id} data-flip={asset.id} className={`row manage-row${drag?.id === asset.id ? ' is-dragging' : ''}${drag ? ' is-sorting' : ''}${drag && drag.id !== asset.id && visual(index) > 0 ? ' divider' : ''}`}
        style={drag ? { transform: drag.id === asset.id ? `translateY(${drag.dy}px) scale(1.02)` : `translateY(${shift(index)}px)` } : undefined}>
        <button type="button" className="grip" aria-label={t('Drag to reorder {symbol}. Arrow keys move it.', { symbol: asset.symbol })} onKeyDown={(event) => {
          // Arrow keys on the grip reorder.
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); move(index, event.key === 'ArrowUp' ? -1 : 1) }
        }} onPointerDown={(event) => startDrag(event, asset.id)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}><GripVertical size={18} /></button>
        <AssetIcon asset={asset} />
        <span className="row-text"><strong>{asset.token ? asset.symbol : asset.name}{imported(asset) && <span className="manage-tag">{t('Imported')}</span>}</strong><small>{where(asset)}</small></span>
        <span className="manage-actions">
          <button type="button" className="icon-button small manage-remove" aria-label={t('Hide {symbol}', { symbol: asset.symbol })} onClick={() => commit(order.filter((entry) => entry.id !== asset.id))}><Minus size={17} /></button>
        </span>
      </div>)}
    </div>
    </>}
    {foundHidden.length > 0 && <>
      <p className="group-label manage-label" data-flip="label-add" data-fade>{t('Add tokens')}</p>
      <div className="group manage-list">
        <span className="manage-bg" data-flip="bg-add" data-scale aria-hidden="true" />
        {foundHidden.map((asset) => asset.token?.user === 'custom' && imports ? <div key={asset.id} data-flip={asset.id} className="row manage-row" onClick={() => commit([...order, asset])}>
          <AssetIcon asset={asset} />
          <span className="row-text"><strong>{asset.symbol}<span className="manage-tag">{t('Imported')}</span></strong><small>{where(asset)}</small></span>
          <span className="manage-actions">
            <button type="button" className="icon-button small manage-remove" aria-label={t('Remove {symbol}', { symbol: asset.symbol })} onClick={(event) => { event.stopPropagation(); imports.remove(asset.id) }}><Trash2 size={16} /></button>
            <button type="button" className="manage-add manage-add-button" aria-label={t('Add {symbol}', { symbol: asset.symbol })} onClick={(event) => { event.stopPropagation(); commit([...order, asset]) }}><Plus size={17} /></button>
          </span>
        </div> : <button type="button" key={asset.id} data-flip={asset.id} className="row manage-row" onClick={() => commit([...order, asset])}>
          <AssetIcon asset={asset} />
          <span className="row-text"><strong>{asset.token ? asset.symbol : asset.name}</strong><small>{where(asset)}</small></span>
          <span className="manage-add"><Plus size={17} /></span>
        </button>)}
      </div>
    </>}
    {shortList && <p className="manage-more" data-flip="more">{t('Search to find more tokens')}</p>}
    </div>
    {!imports && <button type="button" className="button text-button wide" onClick={() => { const next = (assets ? arrangeList(assets, defaults) : arrangeAssets(environment, defaults)).filter((entry) => entry.shown).map((entry) => entry.asset); commit(next) }}>{t('Reset to default')}</button>}
  </Dialog>
}
