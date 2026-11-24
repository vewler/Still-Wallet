import type { Chain } from '../src/networks.ts'

/** Allowlisted REST paths for the non-EVM layer 1s in src/l1. Anything else is rejected. */
const cosmosAddress = '[a-z]{3,10}1[02-9ac-hj-np-z]{38}'
const cosmosGet = [
  /^\/cosmos\/base\/tendermint\/v1beta1\/node_info$/,
  new RegExp(`^/cosmos/bank/v1beta1/balances/${cosmosAddress}/by_denom\\?denom=[a-z]{2,10}$`),
  new RegExp(`^/cosmos/auth/v1beta1/accounts/${cosmosAddress}$`),
  /^\/cosmos\/tx\/v1beta1\/txs\/[A-F\d]{64}$/,
]
type Post = [path: string, check: (body: string) => boolean, type: string, binary?: boolean]
const json = (test: (value: Record<string, unknown>) => boolean) => (body: string) => {
  try { const value = JSON.parse(body); return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && test(value) } catch { return false }
}
const cardanoAddress = /^addr1[02-9ac-hj-np-z]{50,120}$/
const rules: Partial<Record<Chain, { get: RegExp[]; post?: Post | Post[] }>> = {
  hypercore: {
    get: [],
    post: [
      ['/info', json((value) => ['spotMeta', 'spotClearinghouseState', 'userNonFundingLedgerUpdates'].includes(String(value.type)) && (value.user === undefined || /^0x[a-f\d]{40}$/.test(String(value.user)))), 'application/json'],
      ['/exchange', json((value) => (value.action as { type?: unknown } | undefined)?.type === 'spotSend'), 'application/json'],
    ],
  },
  stacks: {
    get: [/^\/v2\/info$/, /^\/v2\/fees\/transfer$/, /^\/extended\/v1\/address\/S[PM][0-9A-HJKMNP-TV-Z]{38,40}\/(?:stx|nonces)$/, /^\/extended\/v1\/tx\/0x[a-f\d]{64}$/],
    post: ['/v2/transactions', (body) => body.length % 2 === 0 && /^[a-f\d]+$/i.test(body), 'application/octet-stream', true],
  },
  tezos: {
    get: [/^\/chains\/main\/blocks\/head\/header$/, /^\/chains\/main\/blocks\/head\/context\/contracts\/tz[123][1-9A-HJ-NP-Za-km-z]{33}\/(?:balance|counter|manager_key)$/],
    post: ['/injection/operation', (body) => /^"[a-f\d]+"$/.test(body), 'application/json'],
  },
  ton: {
    get: [/^\/v2\/getMasterchainInfo$/, /^\/v2\/getWalletInformation\?address=[A-Za-z\d_-]{48}$/, /^\/v3\/transactionsByMessage\?direction=in&msg_hash=[a-f\d]{64}$/],
    post: [
      ['/v2/sendBoc', json((value) => typeof value.boc === 'string' && Object.keys(value).length === 1), 'application/json'],
      ['/v2/estimateFee', json((value) => typeof value.address === 'string' && typeof value.body === 'string'), 'application/json'],
    ],
  },
  cardano: {
    get: [/^\/genesis$/, /^\/tip$/, /^\/epoch_params\?limit=1$/],
    post: [
      ['/address_info', json((value) => Array.isArray(value._addresses) && value._addresses.length === 1 && cardanoAddress.test(String(value._addresses[0])) && Object.keys(value).length === 1), 'application/json'],
      ['/tx_status', json((value) => Array.isArray(value._tx_hashes) && value._tx_hashes.length === 1 && /^[a-f\d]{64}$/.test(String(value._tx_hashes[0])) && Object.keys(value).length === 1), 'application/json'],
      ['/submittx', (body) => body.length % 2 === 0 && /^[a-f\d]+$/i.test(body), 'application/cbor', true],
    ],
  },
  stellar: {
    get: [/^\/$/, /^\/accounts\/G[A-Z2-7]{55}$/, /^\/fee_stats$/, /^\/transactions\/[a-f\d]{64}$/],
    post: ['/transactions_async', (body) => /^tx=[A-Za-z\d%]+$/.test(body), 'application/x-www-form-urlencoded'],
  },
  multiversx: {
    get: [/^\/network\/config$/, /^\/address\/erd1[02-9ac-hj-np-z]{58}(?:\/balance)?$/, /^\/transaction\/[a-f\d]{64}\/status$/],
    post: ['/transaction/send', (body) => { try { const value = JSON.parse(body); return Boolean(value) && typeof value === 'object' && !Array.isArray(value) } catch { return false } }, 'application/json'],
  },
  algorand: {
    get: [/^\/v2\/transactions\/params$/, /^\/v2\/accounts\/[A-Z2-7]{58}\?exclude=all$/, /^\/v2\/transactions\/pending\/[A-Z2-7]{52}$/],
    post: ['/v2/transactions', (body) => body.length % 2 === 0 && /^[a-f\d]+$/i.test(body), 'application/x-binary', true],
  },
  ...Object.fromEntries(['cosmos', 'celestia', 'kava', 'axelar', 'injective'].map((chain) => [chain, {
    get: cosmosGet,
    post: ['/cosmos/tx/v1beta1/txs', (body: string) => { try { const value = JSON.parse(body); return typeof value?.tx_bytes === 'string' && value.mode === 'BROADCAST_MODE_SYNC' && Object.keys(value).length === 2 } catch { return false } }, 'application/json'],
  }])),
}

export const restChains = new Set(Object.keys(rules))

/** Validates one call. Returns the upstream path, body and content type, or undefined when it isn't allowed. */
export function restRoute(chain: Chain, path: string, method: string | undefined, body?: string) {
  const rule = rules[chain]
  if (!rule) return undefined
  if (method === 'GET') return rule.get.some((pattern) => pattern.test(path)) ? { path } : undefined
  const posts = !rule.post ? [] : typeof rule.post[0] === 'string' ? [rule.post as Post] : rule.post as Post[]
  const post = posts.find(([target]) => target === path)
  if (method !== 'POST' || !post || body === undefined || !post[1](body)) return undefined
  return { path, body: post[3] ? Uint8Array.from(Buffer.from(body, 'hex')) : body, type: post[2] }
}

const nearMethods = new Set(['status', 'gas_price', 'broadcast_tx_async', 'tx', 'query'])
const nearQueries = new Set(['view_account', 'view_access_key'])

const filecoinMethods = new Set(['StateNetworkName', 'WalletBalance', 'MpoolGetNonce', 'GasEstimateMessageGas', 'MpoolPush', 'StateSearchMsg'].map((method) => `Filecoin.${method}`))
export const customRpcChains = new Set<Chain>(['near', 'filecoin'])

/** JSON-RPC checks for chains whose params don't fit the generic allowlist (NEAR uses object params). */
export function allowCustomRpc(chain: Chain, body: string) {
  let payload
  try { payload = JSON.parse(body) } catch { return false }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  if (chain === 'filecoin') return filecoinMethods.has(payload.method) && Array.isArray(payload.params) && payload.params.length <= 4
  if (chain !== 'near' || !nearMethods.has(payload.method)) return false
  if (payload.method === 'query') return nearQueries.has(payload.params?.request_type)
  return true
}
