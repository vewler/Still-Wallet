import { useEffect, useRef, useState } from 'react'
import { RefreshIcon } from './Spinner'

const trigger = 64
const hold = 52

/** Pull to refresh: icon rotates with the pull, spins while loading, then hides. */
export function PullRefresh({ enabled, refreshing, refresh }: { enabled: boolean; refreshing: boolean; refresh: () => void }) {
  const [pull, setPull] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [pulled, setPulled] = useState(false)
  // Angle at release, keep spinning from there.
  const [angle, setAngle] = useState(0)
  const latest = useRef({ refreshing, refresh })
  latest.current = { refreshing, refresh }

  useEffect(() => { if (!refreshing) setPulled(false) }, [refreshing])

  useEffect(() => {
    if (!enabled) return
    let start: { x: number; y: number } | null = null
    let distance = 0
    const down = (event: TouchEvent) => {
      const touch = event.touches[0]
      start = event.touches.length === 1 && window.scrollY <= 0 && !document.querySelector('dialog[open]') ? { x: touch.clientX, y: touch.clientY } : null
      distance = 0
    }
    const move = (event: TouchEvent) => {
      if (!start) return
      const dy = event.touches[0].clientY - start.y
      const dx = event.touches[0].clientX - start.x
      // Only a downward drag from the top counts.
      if (!distance && (dy <= 0 || Math.abs(dx) > dy)) { start = null; return }
      event.preventDefault()
      distance = Math.max(0, dy)
      setDragging(true)
      setPull(Math.min(120, distance * .5))
    }
    const up = () => {
      if (!start) return
      start = null
      setDragging(false)
      setAngle(Math.min(120, distance * .5) * 3)
      setPull(0)
      if (distance * .5 >= trigger && !latest.current.refreshing) { setPulled(true); latest.current.refresh() }
    }
    document.addEventListener('touchstart', down, { passive: true })
    document.addEventListener('touchmove', move, { passive: false })
    document.addEventListener('touchend', up)
    document.addEventListener('touchcancel', up)
    return () => {
      document.removeEventListener('touchstart', down)
      document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', up)
      document.removeEventListener('touchcancel', up)
    }
  }, [enabled])

  const loading = pulled && refreshing
  const height = dragging ? pull : loading ? hold : 0
  return <div className={dragging ? 'pull-refresh dragging' : 'pull-refresh'} style={{ height }} aria-hidden="true">
    <span style={{ opacity: loading ? 1 : Math.min(1, pull / trigger), transform: `rotate(${dragging ? pull * 3 : angle}deg) scale(${loading ? 1 : .3 + .7 * Math.min(1, pull / trigger)})` }}>
      <RefreshIcon size={28} spinning={loading} />
    </span>
  </div>
}
