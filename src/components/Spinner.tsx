import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'

/** Spins while busy. Finishes the current turn, then one last eased turn back to 0. */
export function RefreshIcon({ spinning, size }: { spinning: boolean; size: number }) {
  const [phase, setPhase] = useState<'idle' | 'spin' | 'out'>(spinning ? 'spin' : 'idle')
  const stop = useRef(false)

  useEffect(() => {
    stop.current = !spinning
    if (spinning) { setPhase((current) => current === 'idle' || current === 'out' ? 'spin' : current); return }
    // Fallback when animationend doesn't fire (background tab).
    const fallback = window.setTimeout(() => setPhase('idle'), 2200)
    return () => window.clearTimeout(fallback)
  }, [spinning])

  return <span className={`refresh-icon${phase === 'spin' ? ' spinning' : phase === 'out' ? ' spin-out' : ''}`}
    onAnimationIteration={() => { if (stop.current) setPhase('out') }}
    onAnimationEnd={() => setPhase((current) => current === 'out' ? (stop.current ? 'idle' : 'spin') : current)}>
    <RefreshCw size={size} />
  </span>
}
