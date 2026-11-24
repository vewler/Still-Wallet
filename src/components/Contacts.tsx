import { useState, type FormEvent } from 'react'
import { ArrowLeft, BookUser, Check, Plus, Trash2, UserPlus } from 'lucide-react'
import { networks as mainnets, type Network, type NetworkId } from '../networks'
import { normalizeContactName, type Contact } from '../storage'
import { Coin } from './Icons'
import { Dialog, ErrorSlot, Slot } from './Dialog'
import { EmojiPicker } from './EmojiPicker'
import { Picker } from './Picker'
import { t } from '../i18n'

export type EditContact = (contact: Contact, remove?: boolean) => Promise<boolean>

export const shortAddress = (address: string) => address.length > 16 ? `${address.slice(0, 7)}…${address.slice(-5)}` : address

/** EVM addresses work on every EVM network, so those contacts show on all of them. */
export function contactsFor(contacts: Contact[], network: Network) {
  return contacts.filter((contact) => contact.network === network.id || (network.chainId !== undefined && mainnets[contact.network]?.chainId !== undefined))
}

export function findContact(contacts: Contact[], network: Network, address: string) {
  const value = address.trim()
  const evm = network.chainId !== undefined
  return contactsFor(contacts, network).find((contact) => evm ? contact.address.toLowerCase() === value.toLowerCase() : contact.address === value)
}

export function ContactAvatar({ contact, large = false }: { contact: Pick<Contact, 'name' | 'emoji'>; large?: boolean }) {
  return <span className={`wallet-emoji contact-avatar${large ? ' wallet-emoji--large' : ''}${contact.emoji ? '' : ' contact-avatar--letter'}`} aria-hidden="true">{contact.emoji ?? (Array.from(contact.name.trim())[0]?.toUpperCase() || '?')}</span>
}

const newId = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`

/** Name, emoji, network and address. Used by the address book and after a send. */
export function ContactFields({ value, change, networks, lockAddress = false }: {
  value: Omit<Contact, 'id'>; change: (value: Omit<Contact, 'id'>) => void; networks: Network[]; lockAddress?: boolean
}) {
  const [picking, setPicking] = useState(false)
  const network = mainnets[value.network]
  return <>
    <button type="button" className="contact-avatar-button" onClick={() => setPicking(!picking)} aria-expanded={picking} aria-label={value.emoji ? t('Change emoji') : t('Add emoji')}>
      <ContactAvatar contact={{ name: value.name || '?', emoji: value.emoji }} large />
    </button>
    <div className="contact-emoji-actions">
      <button type="button" className="button text-button" onClick={() => setPicking(!picking)}>{picking ? t('Done') : value.emoji ? t('Change emoji') : t('Add emoji (optional)')}</button>
      {value.emoji && <button type="button" className="button text-button" onClick={() => { change({ ...value, emoji: undefined }); setPicking(false) }}>{t('Remove emoji')}</button>}
    </div>
    <Slot open={picking}><EmojiPicker current={value.emoji ?? ''} pick={(emoji) => change({ ...value, emoji })} /></Slot>
    <label className="field">{t('Na⁠me')}<input value={value.name} onChange={(event) => change({ ...value, name: event.target.value })} maxLength={32} name="contact-label" autoComplete="off" autoCorrect="off" spellCheck={false} data-1p-ignore data-lpignore="true" placeholder="Alex" required /></label>
    {lockAddress ? <div className="field"><span>{t('Network')}</span><div className="scramble-target">{network.name}</div></div>
      : <div className="field"><span>{t('Network')}</span>
        <Picker label={t('Network')} value={value.network} onChange={(id: NetworkId) => change({ ...value, network: id })}
          options={networks.map((item) => ({ value: item.id, label: item.name, sub: `${item.label} · ${item.symbol}`, icon: <Coin chain={item.chain} /> }))} />
      </div>}
    <label className="field">{t('Address')}<input className="mono" value={value.address} readOnly={lockAddress} onChange={(event) => change({ ...value, address: event.target.value.trim() })} name="contact-address" placeholder={network.chainId !== undefined ? '0x…' : t('{network} address', { network: network.name })} autoCapitalize="none" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={100} required /></label>
    {network.chainId !== undefined && <p className="field-note">{t('EVM addresses also show up when you send on other EVM networks.')}</p>}
  </>
}

/** Rough shape checks, the real check runs when you send. */
const addressShapes: Partial<Record<Network['chain'], RegExp>> = {
  bitcoin: /^(bc1[02-9ac-hj-np-z]{8,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/i,
  litecoin: /^(ltc1[02-9ac-hj-np-z]{8,87}|[LM3][1-9A-HJ-NP-Za-km-z]{25,34})$/i,
  dogecoin: /^[DA9][1-9A-HJ-NP-Za-km-z]{25,34}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  xrp: /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/,
  monero: /^[48][1-9A-HJ-NP-Za-km-z]{94,105}$/,
  sui: /^0x[\da-fA-F]{1,64}$/,
  aptos: /^0x[\da-fA-F]{1,64}$/,
}

function contactProblem(value: Omit<Contact, 'id'>, contacts: Contact[], id?: string) {
  if (!normalizeContactName(value.name)) return 'Enter a name.'
  if (!value.address || /\s/.test(value.address)) return 'Enter the full address.'
  const network = mainnets[value.network]
  if (network.chainId !== undefined && !/^0x[\da-fA-F]{40}$/.test(value.address)) return 'EVM addresses start with 0x and have 42 characters.'
  const shape = addressShapes[network.chain]
  if (shape && !shape.test(value.address)) return t('That doesn’t look like a {network} address.', { network: network.name })
  const same = findContact(contacts, network, value.address)
  if (same && same.id !== id && same.network === value.network) return t('This address is already saved as {name}.', { name: same.name })
  return ''
}

/** Address book sheet: list, add, edit, delete. */
export function Contacts({ contacts, edit, networks, close }: { contacts: Contact[]; edit: EditContact; networks: Network[]; close: () => void }) {
  const [editing, setEditing] = useState<Contact | 'new'>()
  const [confirm, setConfirm] = useState(false)
  const [value, setValue] = useState<Omit<Contact, 'id'>>({ name: '', address: '', network: networks[0].id })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const current = editing && editing !== 'new' ? editing : undefined

  function open(contact?: Contact) {
    setValue(contact ? { name: contact.name, emoji: contact.emoji, address: contact.address, network: contact.network } : { name: '', address: '', network: networks[0].id })
    setError('')
    setConfirm(false)
    setEditing(contact ?? 'new')
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const problem = contactProblem(value, contacts, current?.id)
    if (problem) { setError(problem); return }
    setBusy(true)
    const ok = await edit({ ...value, name: normalizeContactName(value.name), id: current?.id ?? newId() })
    setBusy(false)
    if (ok) setEditing(undefined)
  }

  async function remove() {
    if (!current) return
    setBusy(true)
    const ok = await edit(current, true)
    setBusy(false)
    if (ok) { setConfirm(false); setEditing(undefined) }
  }

  if (current && confirm) return <Dialog title={t('Delete contact?')} step="delete" close={close} busy={busy}>
    <div className="form"><span className="empty-icon"><Trash2 size={24} /></span>
      <p className="dialog-intro dialog-intro--center">{t('This removes {name} from your Still Wallet address book. Your funds and activity stay the same.', { name: current.name })}</p>
      <div className="two-actions"><button type="button" className="button primary" onClick={() => setConfirm(false)} disabled={busy} autoFocus>{t('Cancel')}</button><button type="button" className="button secondary" onClick={() => void remove()} disabled={busy}>{t('Delete')}</button></div>
    </div>
  </Dialog>

  if (editing) return <Dialog title={current ? t('Edit contact') : t('New contact')} step="edit" close={close} busy={busy}>
    <form className="form" onSubmit={save}>
      <ContactFields value={value} change={(next) => { setValue(next); setError('') }} networks={networks} />
      <ErrorSlot error={error} />
      <button className="button primary wide" type="submit" disabled={busy}>{current ? t('Save contact') : t('Add contact')}</button>
      {current && <button type="button" className="button text-button wide danger-text" onClick={() => setConfirm(true)} disabled={busy}><Trash2 size={16} /> {t('Delete contact')}</button>}
      <button type="button" className="button text-button wide" onClick={() => setEditing(undefined)} disabled={busy}><ArrowLeft size={16} /> {t('Back')}</button>
    </form>
  </Dialog>

  const sorted = [...contacts].sort((a, b) => a.name.localeCompare(b.name))
  return <Dialog title={t('Address book')} step="list" close={close}>
    {sorted.length ? <ul className="wallet-list contact-list">
      {sorted.map((contact) => <li key={contact.id}>
        <button type="button" className="wallet-pick" onClick={() => open(contact)} aria-label={t('Edit {name}', { name: contact.name })}>
          <ContactAvatar contact={contact} />
          <span className="contact-text"><strong>{contact.name}</strong><small><span className="mono">{shortAddress(contact.address)}</span> · {mainnets[contact.network]?.name}</small></span>
          <Coin chain={mainnets[contact.network].chain} />
        </button>
      </li>)}
    </ul> : <div className="form contact-empty"><span className="empty-icon"><BookUser size={24} /></span>
      <p className="dialog-intro dialog-intro--center">{t('No contacts yet. Save addresses you send to often and pick them in Send.')}</p>
    </div>}
    <button type="button" className="button secondary wide" onClick={() => open()}><Plus size={17} /> {t('Add contact')}</button>
  </Dialog>
}

/** After sending to a new address: offer to save it. */
export function SaveContact({ network, address, contacts, edit }: { network: Network; address: string; contacts: Contact[]; edit: EditContact }) {
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [value, setValue] = useState<Omit<Contact, 'id'>>({ name: '', address: address.trim(), network: network.id })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!saved && findContact(contacts, network, address)) return null

  async function save() {
    const problem = contactProblem(value, contacts)
    if (problem) { setError(problem); return }
    setBusy(true)
    const ok = await edit({ ...value, name: normalizeContactName(value.name), id: newId() })
    setBusy(false)
    if (ok) { setSaved(true); setOpen(false) }
  }

  return <>
    <Slot open={open}><div className="form contact-save">
      <ContactFields value={value} change={(next) => { setValue(next); setError('') }} networks={[network]} lockAddress />
      <ErrorSlot error={error} />
      <button type="button" className="button primary wide" onClick={() => void save()} disabled={busy}>{t('Save contact')}</button>
    </div></Slot>
    {!open && <button type="button" className="button secondary wide" onClick={() => setOpen(true)} disabled={saved}><span key={String(saved)} className="label-swap">{saved ? <Check size={17} /> : <UserPlus size={17} />}{saved ? t('Saved to address book') : t('Save to address book')}</span></button>}
  </>
}
