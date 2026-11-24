import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import './styles.css'
import App from './App'
import { languageReady, t } from './i18n'

// Touch = phone layout. Mouse/trackpad = desktop at 590px+, phone below that (switches live on resize).
// ?view=phone or ?view=desktop forces one.
const forced = new URLSearchParams(location.search).get('view')
const pointer = matchMedia('(hover: hover) and (pointer: fine)')
const wide = matchMedia('(min-width: 590px)')
const applyLayout = () => { document.documentElement.dataset.layout = forced === 'phone' || forced === 'desktop' ? forced : pointer.matches && wide.matches ? 'desktop' : 'phone' }
applyLayout()
pointer.addEventListener('change', applyLayout)
wide.addEventListener('change', applyLayout)

// Swap native "Please fill out this field" bubbles for our inline error.
document.addEventListener('invalid', (event) => {
  const field = event.target as HTMLInputElement
  event.preventDefault()
  const box = field.closest('.field') as HTMLElement | null
  if (!box) return
  const message = field.validity.valueMissing ? t('This field is required.') : field.validity.tooShort ? t('Enter at least {count} characters.', { count: field.minLength }) : field.validationMessage
  // Same field failing again: keep the message, just shake it again.
  box.removeAttribute('data-error')
  void box.offsetWidth
  box.setAttribute('data-error', message)
  if (!field.form?.querySelector('.field[data-error] :is(input, textarea):focus')) field.focus()
}, true)
document.addEventListener('input', (event) => { (event.target as HTMLElement).closest?.('.field[data-error]')?.removeAttribute('data-error') }, true)

// Touch: the keyboard only opens on a real tap. Programmatic focus (autofocus, jump to error) is dropped.
const touchScreen = matchMedia('(pointer: coarse)')
let lastPress: EventTarget | null = null
document.addEventListener('pointerdown', (event) => { lastPress = event.target }, true)
document.addEventListener('focusin', (event) => {
  const field = event.target as HTMLElement
  if (!touchScreen.matches || !field.matches?.('input:not([readonly]), textarea:not([readonly])')) return
  const tapped = lastPress instanceof Node && (field === lastPress || field.closest('label')?.contains(lastPress))
  // The keyboard's Next key counts as a real tap.
  const from = (event as FocusEvent).relatedTarget
  const fromField = from instanceof HTMLElement && from.matches('input, textarea')
  if (!tapped && !fromField) field.blur()
}, true)

// Action tiles and the manage button replay their icon animation on every tap.
document.addEventListener('pointerdown', (event) => {
  const icon = (event.target as Element).closest?.('.action:not(:disabled), .round-button')?.querySelector('.action svg:not(.lucide-refresh-cw, .lucide-box), svg.lucide-sliders-horizontal')
  if (!icon) return
  icon.classList.remove('tap')
  void (icon as SVGElement).getBoundingClientRect() // restart the animation
  icon.classList.add('tap')
}, { passive: true })
// Only the icon's own animationend clears the tap.
document.addEventListener('animationend', (event) => { const target = event.target as Element; if (target instanceof SVGSVGElement) target.classList.remove('tap') })

// Load the saved or device language first so the first paint is already translated.
void languageReady.then(() => createRoot(document.getElementById('root')!).render(<App />))
