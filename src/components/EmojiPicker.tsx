import { useLayoutEffect, useRef, useState } from 'react'
import { emojiCategories } from '../storage'
import { t } from '../i18n'

/** Category tabs + scrolling grid, like a phone emoji keyboard. */
/** Highlight that slides to the child matching `selector`. No animation the first time. */
export function SlideRing({ selector, watch }: { selector: string; watch: unknown }) {
  const ring = useRef<HTMLSpanElement>(null)
  const placed = useRef(false)
  useLayoutEffect(() => {
    const element = ring.current!
    const target = element.parentElement?.querySelector<HTMLElement>(selector)
    if (!target) { element.style.opacity = '0'; placed.current = false; return }
    element.style.transition = placed.current ? '' : 'none'
    Object.assign(element.style, { opacity: '1', width: `${target.offsetWidth}px`, height: `${target.offsetHeight}px`, transform: `translate(${target.offsetLeft}px, ${target.offsetTop}px)` })
    placed.current = true
  }, [selector, watch])
  return <span ref={ring} className="slide-ring" aria-hidden="true" />
}

export function EmojiPicker({ current, pick }: { current: string; pick: (emoji: string) => void }) {
  const [tab, setTab] = useState(() => Math.max(0, emojiCategories.findIndex((category) => category.emojis.includes(current))))
  const category = emojiCategories[tab]
  return <div className="emoji-picker">
    <div className="emoji-tabs" role="tablist" aria-label={t('Emoji categories')}>
      <SlideRing selector='[aria-selected="true"]' watch={tab} />
      {emojiCategories.map((item, index) => <button type="button" role="tab" key={item.name} aria-selected={index === tab} aria-label={t(item.name)} onClick={() => setTab(index)}>{item.emojis[0]}</button>)}
    </div>
    <p className="emoji-category">{t(category.name)}</p>
    <div className="emoji-grid" role="radiogroup" aria-label={t('{category} emoji', { category: t(category.name) })} key={category.name}>
      <SlideRing selector='[aria-checked="true"]' watch={current} />
      {category.emojis.map((emoji) => <button type="button" role="radio" aria-checked={emoji === current} aria-label={emoji} key={emoji} onClick={() => pick(emoji)}>{emoji}</button>)}
    </div>
  </div>
}
