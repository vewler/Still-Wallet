import { useCallback, useEffect, useRef, useState } from 'react'
import { activeNetworks, defaultEndpoint, networks, tokenExplorers, type Network, type NetworkId } from './networks'
import { contractKey, setUserTokens, tokens, tokensFor, userTokenId, type UserToken } from './tokens'
import { defaultLayout, type AssetLayout } from './assets'
import { VAULT_KEY, activitySaved, forgetActivity, loadActivity, readActivity, readAssetLayout, readUserTokens, saveAssetLayout, saveUserTokens, savedVaultId, saveAccounts, forgetWallet, nextAccount, nextOwnPhraseSlot, saveWalletEmoji, saveWalletName, walletEmoji, walletIds, walletName, readPreferences, saveActivity, savePreferences, forgetContacts, loadContacts, saveContacts, type ActivityItem, type Contact, type Preferences } from './storage'
import type { Session } from './vault'
import { deriveSession, stopDeriving } from './derive'
import type { Prices, Quote } from './rpc'
import type { Balance } from './components/Overview'
import { t } from './i18n'

const PRICE_CACHE = 'still.prices.v1'
function readPriceCache(currency: string): { prices: Prices; changes: Prices } {
  try {
    const value = JSON.parse(localStorage.getItem(PRICE_CACHE) ?? 'null') as { currency?: string; prices?: Prices; changes?: Prices } | null
    if (value && value.currency === currency && value.prices && value.changes) return { prices: value.prices, changes: value.changes }
  } catch { /* Start empty. */ }
  return { prices: {}, changes: {} }
}

const monero = 'monero-main'
let moneroUsed = false

function hasVault() {
  try { return localStorage.getItem(VAULT_KEY) !== null } catch { return false }
}

export function useWallet(close: () => void, notify: (message: string) => void) {
  const [preferences, setPreferences] = useState(readPreferences)
  const [saved, setSaved] = useState(hasVault)
  const [session, setSession] = useState<Session>()
  const [name, setName] = useState(() => { const id = savedVaultId(); return id ? walletName(id) : '' })
  const [wallets, setWallets] = useState<{ id: string; account: number; name: string; emoji: string }[]>([])
  const [balances, setBalances] = useState<Partial<Record<NetworkId, Balance>>>({})
  const [items, setItems] = useState<ActivityItem[]>([])
  const [layout, setLayout] = useState<AssetLayout>(defaultLayout)
  const [refreshing, setRefreshing] = useState(false)
  // Last prices are cached locally so totals show instantly on open.
  const [prices, setPrices] = useState<Prices>(() => readPriceCache(readPreferences().currency).prices)
  const [changes, setChanges] = useState<Prices>(() => readPriceCache(readPreferences().currency).changes)
  const [tokenBalances, setTokenBalances] = useState<Record<string, Balance>>({})
  const [userTokens, setUserTokenState] = useState<UserToken[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const lastDiscovery = useRef(new Map<string, number>())
  const active = useRef<Session | undefined>(undefined)
  const preloaded = useRef<Session | undefined>(undefined)
  const currentPreferences = useRef(preferences)
  const connection = useRef<AbortController | null>(null)
  const refreshRequest = useRef<AbortController | null>(null)
  const submitting = useRef(false)
  // While unlocked: opened wallets by list place, and each wallet's last balances, so switching back is instant. Memory only.
  const sessions = useRef(new Map<number, Promise<Session>>())
  const seen = useRef(new Map<string, { balances: Partial<Record<NetworkId, Balance>>; tokens: Record<string, Balance> }>())
  const target = useRef<number | undefined>(undefined)
  const [switching, setSwitching] = useState<string>()

  const resetRequests = useCallback(() => {
    connection.current?.abort()
    connection.current = new AbortController()
    refreshRequest.current?.abort()
    setRefreshing(false)
  }, [])

  const lock = useCallback(() => {
    if (moneroUsed) void import('./moneroWallet').then((monero) => monero.closeMonero())
    active.current = undefined
    target.current = undefined
    sessions.current.clear()
    seen.current.clear()
    stopDeriving()
    setSwitching(undefined)
    forgetActivity()
    forgetContacts()
    setContacts([])
    resetRequests()
    setSession(undefined)
    setBalances({})
    setTokenBalances({})
    applyTokens([])
    setItems([])
    close()
  }, [close, resetRequests])

  useEffect(() => {
    const syncVault = (event: StorageEvent) => {
      if (event.key !== VAULT_KEY && event.key !== null) return
      lock()
      setSaved(hasVault())
    }
    window.addEventListener('storage', syncVault)
    return () => window.removeEventListener('storage', syncVault)
  }, [lock])

  useEffect(() => {
    if (!session) return
    if (preferences.autoLock === 0) {
      // Instant: lock on hide or blur.
      const visibility = () => { if (document.visibilityState === 'hidden') lock() }
      window.addEventListener('blur', lock)
      document.addEventListener('visibilitychange', visibility)
      return () => { window.removeEventListener('blur', lock); document.removeEventListener('visibilitychange', visibility) }
    }
    const duration = preferences.autoLock * 60_000
    let deadline = Date.now() + duration
    let timer = setTimeout(lock, duration)
    function activity() {
      if (Date.now() >= deadline) { lock(); return }
      deadline = Date.now() + duration
      clearTimeout(timer)
      timer = setTimeout(lock, duration)
    }
    function visibility() {
      if (Date.now() >= deadline) lock()
    }
    window.addEventListener('pointerdown', activity, { passive: true })
    window.addEventListener('keydown', activity)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pageshow', visibility)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', activity)
      window.removeEventListener('keydown', activity)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pageshow', visibility)
    }
  }, [lock, session, preferences.autoLock])

  /** Load balances behind the lock screen, so the wallet opens with them already there. */
  async function preload(value: Session) {
    active.current = value
    resetRequests()
    setBalances({})
    setTokenBalances({})
    applyTokens(readUserTokens(value.id))
    if (currentPreferences.current.offline) return
    preloaded.current = value
    await Promise.race([refresh('balances', true), new Promise((done) => setTimeout(done, 8000))])
  }

  // Remember what each wallet showed, for when you switch back to it.
  useEffect(() => {
    if (session) seen.current.set(session.id, { balances, tokens: tokenBalances })
  }, [session, balances, tokenBalances])

  function start(value: Session) {
    const ready = preloaded.current === value
    preloaded.current = undefined
    active.current = value
    target.current = undefined
    setSwitching(undefined)
    sessions.current.set(value.slot, Promise.resolve(value))
    if (!ready) resetRequests()
    setSaved(true)
    setSession(value)
    setName(walletName(value.id))
    setItems([])
    applyTokens(readUserTokens(value.id))
    void loadActivity(value.id, value.activityKey).then((items) => { if (active.current === value) setItems(items) }, () => {})
    void loadContacts(value.vault, value.activityKey).then((items) => { if (active.current === value) setContacts(items) }, () => {})
    setLayout(readAssetLayout(value.id, defaultLayout))
    loadWallets(value.vault)
    if (ready) return
    // A wallet opened before shows its last balances while new ones load.
    const last = seen.current.get(value.id)
    setBalances(last?.balances ?? {})
    setTokenBalances(last?.tokens ?? {})
    // Load balances right after unlock/switch.
    if (!currentPreferences.current.offline) void refresh('balances', true)
  }

  /** Save shown coins and their order. */
  function arrange(next: AssetLayout) {
    const wallet = active.current
    if (next.shown.includes(monero) && !layout.shown.includes(monero) && wallet && !currentPreferences.current.offline) loadMonero(wallet, connection.current?.signal)
    setLayout(next)
    if (wallet) try { saveAssetLayout(wallet.id, next) } catch { notify('This browser could not save your token list.') }
  }

  /** This wallet's imported and found tokens join the asset list. */
  function applyTokens(list: UserToken[]) {
    setUserTokens(list)
    setUserTokenState(list)
  }

  /** Add tokens to this wallet and show them on Home. */
  /** Found tokens show on Home right away, imported ones wait in Manage tokens > Add tokens. */
  function addTokens(wallet: Session, added: UserToken[], show = true) {
    const same = (a: UserToken, b: UserToken) => a.network === b.network && contractKey(a.network, a.contract) === contractKey(b.network, b.contract)
    const next = [...readUserTokens(wallet.id).filter((entry) => !added.some((token) => same(entry, token))), ...added]
    saveUserTokens(wallet.id, next)
    applyTokens(next)
    if (!show) return
    const ids = added.map((token) => userTokenId(token.network, token.contract))
    const current = readAssetLayout(wallet.id, defaultLayout)
    const shown = [...current.shown.filter((id) => !ids.includes(id)), ...ids]
    const nextLayout = { order: [...shown, ...current.order.filter((id) => !shown.includes(id))], shown }
    setLayout(nextLayout)
    saveAssetLayout(wallet.id, nextLayout)
  }

  /** Paste-an-address import from Settings. */
  function importToken(token: UserToken) {
    const wallet = active.current
    if (!wallet) return false
    try { addTokens(wallet, [token], false) } catch { notify('This browser could not save the token.'); return false }
    void loadPrices(currentPreferences.current.currency)
    void refresh('balances', true)
    return true
  }

  /** Imported tokens can be removed again, built-in ones only hidden. */
  function removeToken(id: string) {
    const wallet = active.current
    if (!wallet) return
    const next = readUserTokens(wallet.id).filter((token) => userTokenId(token.network, token.contract) !== id)
    try { saveUserTokens(wallet.id, next) } catch { notify('This browser could not save your token list.'); return }
    applyTokens(next)
    const current = readAssetLayout(wallet.id, defaultLayout)
    const nextLayout = { order: current.order.filter((entry) => entry !== id), shown: current.shown.filter((entry) => entry !== id) }
    setLayout(nextLayout)
    try { saveAssetLayout(wallet.id, nextLayout) } catch { /* Gone from the list anyway. */ }
  }

  /** Look for tokens the wallet holds that Still doesn't list yet. At most every 10 min per wallet. */
  async function discover(wallet: Session, signal: AbortSignal) {
    const prefs = currentPreferences.current
    if (Date.now() - (lastDiscovery.current.get(wallet.id) ?? 0) < 10 * 60_000) return
    lastDiscovery.current.set(wallet.id, Date.now())
    try {
      const { discoverTokens } = await import('./discover')
      const list = activeNetworks(prefs.environment).filter((network) => network.chain === 'solana' || tokenExplorers[network.id])
      const results = await Promise.allSettled(list.map((network) => discoverTokens(network, prefs.rpc[network.id] ?? defaultEndpoint(network), wallet.addresses, signal)))
      if (signal.aborted || active.current !== wallet) { lastDiscovery.current.delete(wallet.id); return }
      // A failed network gets another look on the next refresh.
      if (results.some((entry) => entry.status === 'rejected')) lastDiscovery.current.set(wallet.id, Date.now() - 8 * 60_000)
      const saved = readUserTokens(wallet.id)
      const found = results.flatMap((entry) => entry.status === 'fulfilled' ? entry.value : [])
        .filter(({ token }) => !saved.some((entry) => entry.network === token.network && contractKey(token.network, entry.contract) === contractKey(token.network, token.contract)))
      if (!found.length) return
      addTokens(wallet, found.map((entry) => entry.token))
      setTokenBalances((current) => ({ ...current, ...Object.fromEntries(found.map(({ token, amount }) => [userTokenId(token.network, token.contract), { amount }])) }))
      void loadPrices(prefs.currency)
      notify(found.length === 1 ? t('Found {symbol} in your wallet', { symbol: found[0].token.symbol }) : t('Found {count} tokens in your wallet', { count: found.length }))
    } catch { /* Discovery is best effort. */ }
  }

  /** XMR scans separately (and only while shown), it can take much longer than the other balances. */
  function loadMonero(wallet: Session, signal?: AbortSignal) {
    const network = networks[monero]
    moneroUsed = true
    void import('./moneroWallet').then((xmr) => xmr.moneroBalance(wallet, currentPreferences.current.rpc[monero] ?? defaultEndpoint(network))).then(
      (amount) => { if (active.current === wallet && !signal?.aborted) setBalances((current) => ({ ...current, [monero]: { amount } })) },
      () => { if (active.current === wallet && !signal?.aborted) setBalances((current) => ({ ...current, [monero]: { unavailable: true } })) },
    )
  }

  function loadWallets(vault: string) {
    setWallets(walletIds(vault).map(({ id, account }) => ({ id, account, name: walletName(id), emoji: walletEmoji(id, account) })))
  }

  /** A wallet's session, made once per unlock. */
  function openSlot(wallet: Session, slot: number) {
    const saved = sessions.current.get(slot)
    if (saved) return saved
    const next = import('./vault').then((vault) => vault.walletSource(wallet, slot))
      .then((source) => deriveSession({ vault: wallet.vault, root: wallet.root, slot, ...source }))
    sessions.current.set(slot, next)
    next.catch(() => { if (sessions.current.get(slot) === next) sessions.current.delete(slot) })
    return next
  }

  /** Make the listed wallets ready in the background while the Wallets sheet is open. */
  async function warmWallets() {
    const wallet = active.current
    if (!wallet) return
    for (const { account } of walletIds(wallet.vault).slice(0, 20)) {
      if (active.current?.vault !== wallet.vault) return
      if (!sessions.current.has(account)) await openSlot(wallet, account).catch(() => {})
    }
  }

  /** The tapped wallet shows as open right away; its balances follow. */
  async function switchWallet(account: number) {
    const wallet = active.current
    if (!wallet) return
    target.current = account
    if (account === wallet.slot) { setSwitching(undefined); return }
    setSwitching(account ? `${wallet.vault}:${account}` : wallet.vault)
    const next = await openSlot(wallet, account).catch(() => undefined)
    if (target.current !== account || active.current?.vault !== wallet.vault) return
    if (!next) { target.current = undefined; setSwitching(undefined); return }
    try { saveAccounts(wallet.vault, { active: account }) } catch { /* Still switch for this session. */ }
    start(next)
  }

  async function addWallet() {
    const wallet = active.current
    if (!wallet) return
    const account = nextAccount(wallet.vault)
    if (account === undefined) { notify('You can add up to 100 wallets.'); return }
    const order = [...walletIds(wallet.vault).map((entry) => entry.account), account]
    try { saveAccounts(wallet.vault, { count: Math.max(...order.filter((entry) => entry < 100)) + 1, order }) } catch { notify('This browser could not save the new wallet.'); return }
    loadWallets(wallet.vault)
    notify('Wallet added')
  }

  /** Add a wallet with its own recovery phrase. Throws a message for the form. */
  async function addPhraseWallet(phrase: string) {
    const wallet = active.current
    if (!wallet) throw new Error('The wallet is unavailable. Unlock and try again.')
    const slot = nextOwnPhraseSlot(wallet.vault)
    if (slot === undefined) throw new Error('You can add up to 100 wallets.')
    await (await import('./vault')).addOwnPhrase(wallet, phrase, slot)
    if (active.current !== wallet) return
    try { saveAccounts(wallet.vault, { order: [...walletIds(wallet.vault).map((entry) => entry.account), slot] }) } catch { throw new Error('This browser could not save the new wallet.') }
    loadWallets(wallet.vault)
    notify('Wallet added')
  }

  /** New wallet order on the Wallets sheet. */
  function orderWallets(order: number[]) {
    const wallet = active.current
    if (!wallet) return
    try { saveAccounts(wallet.vault, { order }) } catch { notify('This browser could not save the order.') }
    loadWallets(wallet.vault)
  }

  /** Removes a wallet from this device. Deleting the open one switches to the top wallet. */
  async function deleteWallet(account: number) {
    const wallet = active.current
    if (!wallet) return false
    const list = walletIds(wallet.vault)
    const entry = list.find((item) => item.account === account)
    const rest = list.filter((item) => item.account !== account)
    if (!entry || !rest.length) return false
    if (account === wallet.slot) {
      const next = await openSlot(wallet, rest[0].account)
      if (active.current !== wallet) return false
      try { saveAccounts(wallet.vault, { order: rest.map((item) => item.account), active: rest[0].account }) } catch { notify('This browser could not delete the wallet.'); return false }
      start(next)
    } else {
      try { saveAccounts(wallet.vault, { order: rest.map((item) => item.account) }) } catch { notify('This browser could not delete the wallet.'); return false }
    }
    try { forgetWallet(entry.id) } catch { /* Leftovers are harmless, the wallet is gone from the list. */ }
    sessions.current.delete(account)
    seen.current.delete(entry.id)
    if (account >= 100) await (await import('./vault')).removeOwnPhrase(wallet, account).catch(() => {})
    loadWallets(wallet.vault)
    notify('Wallet deleted')
    return true
  }

  function rename(value: string, id = active.current?.id) {
    const wallet = active.current
    if (!wallet || !id) return false
    try {
      const saved = saveWalletName(id, value)
      if (id === wallet.id) setName(saved)
      loadWallets(wallet.vault)
      return true
    }
    catch (problem) { notify(problem instanceof Error && problem.message === 'Enter a wallet name.' ? problem.message : 'This browser could not save the name.'); return false }
  }

  function setEmoji(id: string, emoji: string) {
    const wallet = active.current
    if (!wallet) return
    try { saveWalletEmoji(id, emoji); loadWallets(wallet.vault) } catch { notify('This browser could not save the emoji.') }
  }

  function update(change: Partial<Preferences>) {
    const previous = currentPreferences.current
    const next = { ...previous, ...change }
    try { savePreferences(next) } catch { notify('This browser could not save your preferences.'); return false }
    currentPreferences.current = next
    if (change.environment || change.rpc || change.offline !== undefined) {
      seen.current.clear()
      resetRequests()
      setBalances({})
      setTokenBalances({})
    }
    if (change.currency && change.currency !== previous.currency) {
      setPrices({})
      setChanges({})
    }
    setPreferences(next)
    return true
  }

  async function refresh(kind: 'balances' | 'activity', quiet = false) {
    const wallet = active.current
    const prefs = currentPreferences.current
    if (!wallet || prefs.offline) return
    refreshRequest.current?.abort()
    const request = new AbortController()
    refreshRequest.current = request
    setRefreshing(true)
    try {
      const rpc = await import('./rpc')
      if (request.signal.aborted) return
      if (kind === 'balances') {
        if (prefs.environment === 'main') void loadPrices(prefs.currency)
        const networkList = activeNetworks(prefs.environment).filter((network) => network.id !== monero)
        if (readAssetLayout(wallet.id, defaultLayout).shown.includes(monero)) loadMonero(wallet, request.signal)
        const tokenList = tokensFor(prefs.environment)
        // Public providers drop the odd call, so each network gets one more try before it shows as failed.
        const retry = async <T,>(load: () => Promise<T>) => {
          try { return await load() } catch (error) {
            if (request.signal.aborted) throw error
            await new Promise((done) => setTimeout(done, 700))
            if (request.signal.aborted) throw error
            return load()
          }
        }
        const [result, tokenResult] = await Promise.all([
          Promise.allSettled(networkList.map((network) => retry(() => rpc.getBalance(network, prefs.rpc[network.id] ?? defaultEndpoint(network), wallet.addresses, request.signal)))),
          Promise.allSettled(networkList.map((network) => retry(() => rpc.getTokenBalances(network, prefs.rpc[network.id] ?? defaultEndpoint(network), wallet.addresses, tokenList.filter((token) => token.network === network.id), request.signal)))),
        ])
        if (request.signal.aborted) return
        setBalances((current) => ({ ...current, ...Object.fromEntries(result.map((entry, index) => [networkList[index].id, entry.status === 'fulfilled' ? { amount: entry.value } : { unavailable: true }])) }))
        const loaded: Record<string, Balance> = {}
        tokenResult.forEach((entry, index) => tokenList.filter((token) => token.network === networkList[index].id).forEach((token) => {
          loaded[token.id] = entry.status === 'fulfilled' && entry.value[token.id] !== undefined ? { amount: entry.value[token.id] } : { unavailable: true }
        }))
        setTokenBalances(loaded)
        const failed = [...result, ...tokenResult].some((entry) => entry.status === 'rejected')
        // Background loads stay silent. Coins that failed show as unavailable.
        if (!quiet) notify(failed ? 'Some RPCs could not load balances.' : 'Balances refreshed')
        if (prefs.environment === 'main') void discover(wallet, request.signal)
      } else {
        const pending = readActivity(wallet.id).filter((item) => item.status === 'submitted' || item.status === 'unknown').slice(0, 30)
        const result = await Promise.allSettled(pending.map((item) => {
          const network = networks[item.network]
          return rpc.checkTransaction(item, network, prefs.rpc[network.id] ?? defaultEndpoint(network), request.signal)
        }))
        if (request.signal.aborted) return
        result.forEach((entry, index) => {
          const item = pending[index]
          if (entry.status === 'fulfilled' && entry.value !== item.status) saveActivity(wallet.id, { ...item, status: entry.value })
        })
        setItems(readActivity(wallet.id))
        notify(result.some((entry) => entry.status === 'rejected') ? 'Some transaction statuses could not be checked.' : 'Activity refreshed')
      }
    } catch {
      if (!request.signal.aborted) notify('Still could not refresh. Try again.')
    } finally {
      if (!request.signal.aborted) setRefreshing(false)
    }
  }

  async function loadPrices(currency: string) {
    try {
      const signal = connection.current?.signal ?? new AbortController().signal
      const [base, extra] = await Promise.all([
        (await import('./rpc')).getPrices(currency, signal),
        tokens.some((token) => token.user) ? (await import('./discover')).userTokenPrices(tokens, currency, signal) : { prices: {}, changes: {} },
      ])
      const next = { prices: { ...base.prices, ...extra.prices }, changes: { ...base.changes, ...extra.changes } }
      if (!signal.aborted && currentPreferences.current.currency === currency) {
        setPrices(next.prices)
        setChanges(next.changes)
        try { localStorage.setItem(PRICE_CACHE, JSON.stringify({ currency, ...next })) } catch { /* Live prices still show. */ }
      }
    } catch { /* Fiat values fall back to token amounts. */ }
  }

  // Prices load on open (and again on unlock, since locking aborts requests),
  // then every 2 min because of CoinGecko's rate limit.
  useEffect(() => {
    if (preferences.offline) return
    void loadPrices(preferences.currency)
    const timer = window.setInterval(() => void loadPrices(preferences.currency), 120_000)
    return () => window.clearInterval(timer)
  }, [preferences.offline, preferences.currency, session])

  async function prepareQuote(network: Network, signal: AbortSignal, quote: (endpoint: string, wallet: Session, signal: AbortSignal) => Promise<Quote>) {
    const wallet = active.current
    const prefs = currentPreferences.current
    const connectionSignal = connection.current?.signal
    if (!wallet || !connectionSignal || prefs.offline || !network.id.endsWith(`-${prefs.environment}`)) throw new Error('Open your wallet and enable network requests first.')
    const request = AbortSignal.any([signal, connectionSignal])
    request.throwIfAborted()
    return quote(prefs.rpc[network.id] ?? defaultEndpoint(network), wallet, request)
  }

  function prepare(network: Network, to: string, amount: string, signal: AbortSignal, asset?: string, tag?: string) {
    if (network.chain === 'monero') moneroUsed = true
    return prepareQuote(network, signal, async (endpoint, wallet, request) => network.chain === 'monero'
      ? (await import('./moneroWallet')).quoteMonero(network, endpoint, wallet, to, amount, request)
      : (await import('./rpc')).quoteTransfer(network, endpoint, wallet.addresses, to, amount, request, asset, tag))
  }

  function prepareSwap(network: Network, sell: string, buy: string, amount: string, signal: AbortSignal, slippage?: number) {
    return prepareQuote(network, signal, async (endpoint, wallet, request) =>
      (await import('./swap')).quoteSwap(network, endpoint, wallet.addresses.ethereum, sell, buy, amount, request, slippage))
  }

  /** Swap between any two coins. Same-network swaps on Ethereum/Base use Uniswap, everything else NEAR Intents. */
  async function prepareAnySwap(sell: string, buy: string, amount: string, signal: AbortSignal, slippage = 0) {
    const swap = await import('./swap')
    const from = swap.assetNetwork(sell)
    if (!from) throw new Error('Pick a coin to pay with.')
    if (from && from.id === swap.assetNetwork(buy)?.id && swap.swapNetworks.includes(from.id as never)) return prepareSwap(from, sell, buy, amount, signal, slippage)
    return prepareQuote(from, signal, async (_endpoint, wallet, request) =>
      swap.quoteCrossSwap(wallet.addresses, sell, buy, amount, request, slippage, (network, to, value, asset, tag) => prepare(network, to, value, request, asset, tag)))
  }

  /** Transactions from connected apps (WalletConnect). */
  function prepareDapp(network: Network, from: string, call: { to?: string; value?: string; data?: `0x${string}` }, app: string, signal: AbortSignal) {
    return prepareQuote(network, signal, async (endpoint, _wallet, request) => (await import('./rpc')).quoteDapp(network, endpoint, from, call, app, request))
  }

  /** Signing for connected apps, with the RPC the user picked. */
  async function withEndpoint<T>(network: Network, signal: AbortSignal, task: (endpoint: string, wallet: Session, signal: AbortSignal) => Promise<T>) {
    const wallet = active.current
    const prefs = currentPreferences.current
    const connectionSignal = connection.current?.signal
    if (!wallet || !connectionSignal || prefs.offline) throw new Error('Open your wallet and enable network requests first.')
    return task(prefs.rpc[network.id] ?? defaultEndpoint(network), wallet, AbortSignal.any([signal, connectionSignal]))
  }

  async function submit(quote: Quote) {
    const wallet = active.current
    const signal = connection.current?.signal
    if (!wallet || !signal || submitting.current) throw new Error('The wallet is unavailable. Unlock and try again.')
    const perform = async () => {
      const prefs = currentPreferences.current
      if (active.current !== wallet || signal.aborted || prefs.offline || !quote.network.id.endsWith(`-${prefs.environment}`)) throw new Error('The wallet or network settings changed. Open a new transfer.')
      if (Date.now() > quote.expires) throw new Error('The fee quote expired. Edit the transfer to request a new one.')
      const related = readActivity(wallet.id).filter((item) => item.network === quote.network.id && item.to === quote.to &&
        item.asset === quote.asset && item.kind === quote.kind && item.destinationTag === quote.destinationTag &&
        (item.value === quote.value || quote.kind === 'approval') && item.receive?.symbol === quote.receive?.symbol &&
        (item.status === 'unknown' || (quote.kind === 'approval' && item.status === 'submitted')))
      if (related.length) {
        const rpc = await import('./rpc')
        const endpoint = prefs.rpc[quote.network.id] ?? defaultEndpoint(quote.network)
        for (const item of related) {
          const status = await rpc.checkTransaction(item, quote.network, endpoint, signal)
          signal.throwIfAborted()
          if (status === 'unknown' || status === 'submitted') throw new Error('A related transaction is pending or unverified. Check Activity before trying again.')
          setItems(saveActivity(wallet.id, { ...item, status }))
          if (status === 'confirmed' && quote.kind !== 'approval') throw new Error('A matching transaction was confirmed. Check Activity before sending again.')
        }
        if (quote.kind === 'approval') throw new Error('Your token approval changed. Request a fresh swap quote.')
      }
      const signed = await quote.sign(wallet)
      signal.throwIfAborted()
      const item: ActivityItem = {
        hash: signed.hash, to: quote.to, value: quote.value, network: quote.network.id, created: Date.now(), status: 'unknown',
        lastValidBlockHeight: signed.lastValidBlockHeight, lastLedgerSequence: signed.lastLedgerSequence, from: signed.from,
        asset: quote.asset, destinationTag: quote.destinationTag, kind: quote.kind, receive: quote.receive, app: quote.app,
      }
      // Save the tx id before broadcasting so a timeout can be recovered.
      const pending = saveActivity(wallet.id, item)
      if (active.current === wallet) setItems(pending)
      await activitySaved()
      try { await signed.broadcast(); item.status = 'submitted' } catch { /* Submission is ambiguous until checked by hash. */ }
      if (hasVault() && readActivity(wallet.id).some((entry) => entry.hash === item.hash)) {
        try {
          const updated = saveActivity(wallet.id, item)
          if (active.current === wallet) setItems(updated)
        } catch { /* The pre-broadcast entry remains available. */ }
      }
      return item
    }

    submitting.current = true
    try {
      return await (navigator.locks ? navigator.locks.request(`still.send.${wallet.id}`, perform) : perform())
    } finally {
      submitting.current = false
    }
  }

  function removed() {
    lock()
    setSaved(false)
    setName('')
    setWallets([])
    // Delete resets settings too, reload them.
    currentPreferences.current = readPreferences()
    setPreferences(currentPreferences.current)
  }

  /** Add, change or remove (null) a contact. Returns false if the browser could not save it. */
  async function editContact(contact: Contact, remove = false) {
    const wallet = active.current
    if (!wallet) return false
    const next = remove ? contacts.filter((entry) => entry.id !== contact.id)
      : contacts.some((entry) => entry.id === contact.id) ? contacts.map((entry) => entry.id === contact.id ? contact : entry) : [...contacts, contact]
    try { setContacts([...await saveContacts(wallet.vault, next)]) } catch { notify('This browser could not save your contacts.'); return false }
    return true
  }

  return {
    contacts, editContact,
    preferences, balances, tokenBalances, layout, arrange, userTokens, importToken, removeToken, items, refreshing, session, wallets, prices, changes,
    name: wallets.find((entry) => entry.id === switching)?.name ?? name,
    emoji: wallets.find((entry) => entry.id === (switching ?? session?.id))?.emoji,
    activeWallet: switching ?? session?.id, warmWallets,
    mode: session ? 'wallet' as const : saved ? 'locked' as const : 'none' as const,
    lock, start, preload, update, refresh, prepare, prepareSwap, prepareAnySwap, prepareDapp, withEndpoint, submit, removed, rename, setEmoji, switchWallet, addWallet, addPhraseWallet, orderWallets, deleteWallet,
  }
}
