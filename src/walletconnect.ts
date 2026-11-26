import type { IWalletKit, WalletKitTypes } from '@reown/walletkit'
import type { SessionTypes } from '@walletconnect/types'
import { networks, type Addresses, type Network } from './networks'

/** Set while sessions exist, so the client reconnects on unlock without loading WalletConnect for everyone. */
const USED_KEY = 'still.walletconnect.v1'
export const solanaChain = `solana:${networks['solana-main'].genesis!.slice(0, 32)}`
export const evmMethods = ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData', 'eth_signTypedData_v4', 'wallet_switchEthereumChain', 'wallet_addEthereumChain']
export const solanaMethods = ['solana_signMessage', 'solana_signTransaction', 'solana_signAndSendTransaction', 'solana_signAllTransactions']

export type Proposal = WalletKitTypes.SessionProposal
export type Request = WalletKitTypes.SessionRequest
export type Prompt = { kind: 'proposal'; event: Proposal } | { kind: 'request'; event: Request }
export type AppSession = SessionTypes.Struct

/** Every EVM network Still has, keyed by chain id. */
export const evmNetworks = new Map(Object.values(networks).filter((network) => network.chainId).map((network) => [network.chainId!, network]))
export function networkForChain(chain: string): Network | undefined {
  if (chain === solanaChain || chain === 'solana:mainnet') return networks['solana-main']
  const match = /^eip155:(\d+)$/.exec(chain)
  return match ? evmNetworks.get(Number(match[1])) : undefined
}

export function walletConnectUsed() {
  try { return localStorage.getItem(USED_KEY) === '1' } catch { return false }
}
function markUsed(used: boolean) {
  try { if (used) localStorage.setItem(USED_KEY, '1'); else localStorage.removeItem(USED_KEY) } catch { /* Reconnects on next open. */ }
}

let prompts: Prompt[] = []
let sessions: AppSession[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())
export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export const currentPrompts = () => prompts
export const currentSessions = () => sessions

function refreshSessions(kit: IWalletKit) {
  sessions = Object.values(kit.getActiveSessions())
  markUsed(sessions.length > 0)
  emit()
}

let client: Promise<IWalletKit> | undefined
export function walletKit() {
  client ??= (async () => {
    const response = await fetch('/api/walletconnect', { credentials: 'omit', cache: 'no-store' }).catch(() => undefined)
    const { projectId } = (response?.ok ? await response.json() : {}) as { projectId?: string }
    if (!projectId) throw new Error('Connecting to apps isn’t available yet. Check back soon.')
    const [{ Core }, { WalletKit }] = await Promise.all([import('@walletconnect/core'), import('@reown/walletkit')])
    // No analytics events to WalletConnect.
    const core = new Core({ projectId, telemetryEnabled: false })
    const kit = await WalletKit.init({
      core,
      metadata: { name: 'Still Wallet', description: 'A privacy-first multi-chain wallet by ow2', url: 'https://stillwallet.net', icons: ['https://stillwallet.net/icons/icon-192.png'] },
    })
    kit.on('session_proposal', (event) => { prompts = [...prompts, { kind: 'proposal', event }]; emit() })
    kit.on('session_request', (event) => { prompts = [...prompts, { kind: 'request', event }]; emit() })
    kit.on('proposal_expire', ({ id }) => { prompts = prompts.filter((prompt) => prompt.kind !== 'proposal' || prompt.event.id !== id); emit() })
    kit.on('session_request_expire', ({ id }) => { prompts = prompts.filter((prompt) => prompt.kind !== 'request' || prompt.event.id !== id); emit() })
    kit.on('session_delete', ({ topic }) => {
      prompts = prompts.filter((prompt) => prompt.kind !== 'request' || prompt.event.topic !== topic)
      refreshSessions(kit)
    })
    refreshSessions(kit)
    return kit
  })()
  client.catch(() => { client = undefined })
  return client.then(async (kit) => { await resumeApps(kit).catch(() => {}); return kit })
}

/** Paused network requests: close the relay connection until they're back on. */
export function pauseApps() {
  void client?.then((kit) => kit.core.relayer.transportClose()).catch(() => {})
}
async function resumeApps(kit: IWalletKit) {
  if (kit.core.relayer.transportExplicitlyClosed) await kit.core.relayer.transportOpen()
}

/** Connect from a wc: link (pasted, scanned or opened from another app). */
export async function pair(uri: string) {
  const value = uri.trim()
  if (!/^wc:[\da-f]{64}@2\?/i.test(value)) throw new Error('That isn’t a WalletConnect link. It starts with wc: and comes from the app’s Connect wallet menu.')
  const kit = await walletKit()
  try {
    await kit.pair({ uri: value })
  } catch (problem) {
    const message = problem instanceof Error ? problem.message : ''
    if (/exist|expired/i.test(message)) throw new Error('This link was already used or expired. Get a fresh one from the app.')
    throw new Error('Couldn’t reach the app. Check your connection and try again.')
  }
}

/** Take a prompt off the queue once its sheet has slid away. */
export function dismiss(prompt: Prompt) {
  prompts = prompts.filter((entry) => entry !== prompt)
  emit()
}

export async function approve(prompt: Prompt & { kind: 'proposal' }, addresses: Addresses) {
  const [kit, { buildApprovedNamespaces }] = await Promise.all([walletKit(), import('@walletconnect/utils')])
  const evmChains = [...evmNetworks.keys()].map((id) => `eip155:${id}`)
  const requested = { ...prompt.event.params.optionalNamespaces, ...prompt.event.params.requiredNamespaces }
  const supportedNamespaces = {
    eip155: { chains: evmChains, methods: evmMethods, events: ['chainChanged', 'accountsChanged'], accounts: evmChains.map((chain) => `${chain}:${addresses.ethereum}`) },
    ...('solana' in requested ? { solana: { chains: [solanaChain], methods: solanaMethods, events: [], accounts: [`${solanaChain}:${addresses.solana}`] } } : {}),
  }
  let namespaces
  try {
    namespaces = buildApprovedNamespaces({ proposal: prompt.event.params, supportedNamespaces })
  } catch {
    throw new Error('This app needs a network Still doesn’t support yet.')
  }
  await kit.approveSession({ id: prompt.event.id, namespaces })
  refreshSessions(kit)
}

export async function reject(prompt: Prompt) {
  const kit = await walletKit().catch(() => undefined)
  if (!kit) return
  if (prompt.kind === 'proposal') await kit.rejectSession({ id: prompt.event.id, reason: { code: 5000, message: 'User rejected.' } }).catch(() => {})
  else await kit.respondSessionRequest({ topic: prompt.event.topic, response: { id: prompt.event.id, jsonrpc: '2.0', error: { code: 5000, message: 'User rejected.' } } }).catch(() => {})
}

export async function respond(prompt: Prompt & { kind: 'request' }, result: unknown) {
  const kit = await walletKit()
  await kit.respondSessionRequest({ topic: prompt.event.topic, response: { id: prompt.event.id, jsonrpc: '2.0', result } })
}

export async function fail(prompt: Prompt & { kind: 'request' }, code: number, message: string) {
  const kit = await walletKit()
  dismiss(prompt)
  await kit.respondSessionRequest({ topic: prompt.event.topic, response: { id: prompt.event.id, jsonrpc: '2.0', error: { code, message } } }).catch(() => {})
}

export async function disconnect(topic: string) {
  const kit = await walletKit()
  try { await kit.disconnectSession({ topic, reason: { code: 6000, message: 'User disconnected.' } }) } finally { refreshSessions(kit) }
}

/** The address this session approved for a chain. */
export function sessionAccount(topic: string, chain: string) {
  const session = sessions.find((entry) => entry.topic === topic)
  const accounts = Object.values(session?.namespaces ?? {}).flatMap((namespace) => namespace.accounts)
  return accounts.find((account) => account.startsWith(`${chain}:`))?.slice(chain.length + 1)
    ?? accounts.find((account) => account.startsWith(`${chain.split(':')[0]}:`))?.split(':')[2]
}

/** Readable host for a dapp url, never trust the name alone. */
export function hostOf(url: string) {
  try { return new URL(url).host } catch { return url }
}

/**
 * Wallet deleted or erased: end every app session and drop WalletConnect's saved data,
 * so the next wallet in this browser starts with no connected apps.
 */
export async function forgetApps() {
  const loaded = client
  client = undefined
  prompts = []
  sessions = []
  markUsed(false)
  emit()
  const kit = loaded ? await loaded.catch(() => undefined) : undefined
  if (kit) {
    // The open client keeps its database busy, so it removes its own sessions and pairings.
    const reason = { code: 6000, message: 'User disconnected.' }
    const ending = Promise.allSettled([
      ...Object.keys(kit.getActiveSessions()).map((topic) => kit.disconnectSession({ topic, reason })),
      ...kit.core.pairing.getPairings().map((pairing) => kit.core.pairing.disconnect({ topic: pairing.topic })),
    ])
    await Promise.race([ending, new Promise((done) => setTimeout(done, 4000))])
    return
  }
  try { for (const key of Object.keys(localStorage)) if (key.startsWith('wc@2')) localStorage.removeItem(key) } catch { /* Nothing saved. */ }
  try { indexedDB.deleteDatabase('WALLET_CONNECT_V2_INDEXED_DB') } catch { /* Nothing saved. */ }
}
