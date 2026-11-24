import { useEffect, useRef, useState } from 'react'
import { RefreshIcon } from './Spinner'

const trigger = 64
const hold = 52
// Finger travel before a touch counts as a pull and not a tap.
const slop = 10
// Rubber band: starts close to 1:1 and gets heavier the further you pull, no hard stop.
const reach = 150
const give = .9
const stretch = (distance: number) => { const x = give * distance / reach; return reach * x / (x + 1) }
const unstretch = (pull: number) => { const x = pull / (reach - pull); return x * reach / give }

/** Pull to refresh: icon rotates with the pull, spins while loading, then hides. */
export function PullRefresh({ enabled, refreshing, refresh }: { enabled: boolean; refreshing: boolean; refresh: () => void }) {
  const [pull, setPull] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [pulled, setPulled] = useState(false)
  // Angle at release, keep spinning from there.
  const [angle, setAngle] = useState(0)
  const latest = useRef({ refreshing, refresh, loading: false })
  latest.current = { refreshing, refresh, loading: pulled && refreshing }

  useEffect(() => { if (!refreshing) setPulled(false) }, [refreshing])

  useEffect(() => {
    if (!enabled) return
    let start: { x: number; y: number } | null = null
    let distance = 0
    let pulling = false
    let last = { y: 0, time: 0 }
    let velocity = 0
    const down = (event: TouchEvent) => {
      const touch = event.touches[0]
      start = event.touches.length === 1 && window.scrollY <= 0 && !document.querySelector('dialog[open]') ? { x: touch.clientX, y: touch.clientY } : null
      distance = 0
      pulling = false
    }
    const move = (event: TouchEvent) => {
      if (!start) return
      const dy = event.touches[0].clientY - start.y
      const dx = event.touches[0].clientX - start.x
      if (!pulling) {
        // A tap wiggles a few px. Wait until the finger really travels before it counts as a pull.
        if (Math.hypot(dx, dy) < slop) { if (dy > 0) event.preventDefault(); return }
        // Only a downward drag from the top counts.
        if (dy <= 0 || Math.abs(dx) > dy) { start = null; return }
        pulling = true
        // Pulling again while it spins picks up from the open gap, so nothing jumps.
        const from = latest.current.loading ? unstretch(hold) : 0
        start = { x: event.touches[0].clientX, y: event.touches[0].clientY - from }
        last = { y: event.touches[0].clientY, time: event.timeStamp }
        velocity = 0
        return
      }
      event.preventDefault()
      distance = Math.max(0, dy)
      const y = event.touches[0].clientY
      const elapsed = event.timeStamp - last.time
      // Smoothed finger speed (px/ms) so one jittery sample doesn't decide the release.
      if (elapsed > 0) velocity = .6 * ((y - last.y) / elapsed) + .4 * velocity
      last = { y, time: event.timeStamp }
      setDragging(true)
      setPull(stretch(distance))
    }
    const up = (event: TouchEvent) => {
      if (!start) return
      if (event.timeStamp - last.time > 90) velocity = 0
      start = null
      if (!pulling) return
      pulling = false
      setDragging(false)
      const pulledTo = stretch(distance)
      setAngle(pulledTo * 3)
      setPull(0)
      // A quick downward flick counts a little early.
      const enough = pulledTo >= trigger || (pulledTo >= trigger * .7 && velocity > .4)
      if (enough && !latest.current.refreshing) { setPulled(true); latest.current.refresh() }
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
