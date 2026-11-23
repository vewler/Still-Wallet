import { encodeFunctionData, erc20Abi, getAddress, parseAbi } from 'viem'
import { formatAmount, parseAmount, type Network } from './networks'
import { evmClient, quoteEvm } from './rpc'
import { tokenById } from './tokens'

const routerAbi = parseAbi([
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
])

const deployments = {
  'ethereum-main': { router: getAddress('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'), weth: getAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2') },
  'base-main': { router: getAddress('0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24'), weth: getAddress('0x4200000000000000000000000000000000000006') },
}
type SwapNetwork = keyof typeof deployments
export const swapNetworks: SwapNetwork[] = ['ethereum-main', 'base-main']

export const slippageOptions = [0, 50, 100, 200, 300]
const stablecoins = ['USDC', 'USDT', 'DAI']

/** `slippage` is in basis points (100 = 1%); 0 means Auto. */
export async function quoteSwap(network: Network, endpoint: string, owner: string, sellId: string, buyId: string, amount: string, signal: AbortSignal, slippage = 0) {
  if (!slippageOptions.includes(slippage)) throw new Error('Choose a supported slippage.')
  if (!swapNetworks.includes(network.id as SwapNetwork)) throw new Error('Select Ethereum or Base to swap.')
  const { router, weth } = deployments[network.id as SwapNetwork]
  const sell = sellId === network.id ? undefined : tokenById(sellId)
  const buy = buyId === network.id ? undefined : tokenById(buyId)
  if (sellId === buyId || (sellId !== network.id && sell?.network !== network.id) || (buyId !== network.id && buy?.network !== network.id)) {
    throw new Error('Select two different assets on this network.')
  }
  const from = getAddress(owner)
  const input = parseAmount(amount, sell?.decimals ?? network.decimals)
  const sellAddress = sell ? getAddress(sell.contract) : weth
  const buyAddress = buy ? getAddress(buy.contract) : weth
  const client = await evmClient(network, endpoint, signal)
  const direct = [sellAddress, buyAddress]
  const paths = sell && buy ? [direct, [sellAddress, weth, buyAddress]] : [direct]
  const quotes = await Promise.allSettled(paths.map(async (path) => {
    const amounts = await client.readContract({ address: router, abi: routerAbi, functionName: 'getAmountsOut', args: [input, path] })
    return { path, output: amounts.length === path.length && amounts[0] === input ? amounts.at(-1)! : 0n }
  }))
  const best = quotes.flatMap((quote) => quote.status === 'fulfilled' ? [quote.value] : [])
    .sort((left, right) => left.output > right.output ? -1 : left.output < right.output ? 1 : 0)[0]
  if (!best || best.output <= 0n) throw new Error('No usable Uniswap v2 quote for this pair and amount.')

  const display = formatAmount(input, sell?.decimals ?? network.decimals)
  const outputDecimals = buy?.decimals ?? network.decimals
  // Price impact vs a tiny trade on the same path (spot rate).
  const probe = input / 1_000n || 1n
  const spot = await client.readContract({ address: router, abi: routerAbi, functionName: 'getAmountsOut', args: [probe, best.path] }).then((amounts) => amounts.at(-1) ?? 0n, () => 0n)
  const impact = spot > 0n ? Math.max(0, 1 - Number(best.output * probe * 10_000n / (spot * input)) / 10_000) : undefined
  // Auto: 0.5% for stable pairs, 1% normally, 2% when impact is 1% or more.
  const chosen = slippage || (sell && buy && stablecoins.includes(sell.symbol) && stablecoins.includes(buy.symbol) ? 50 : (impact ?? 0) >= .01 ? 200 : 100)
  const minimum = (best.output * BigInt(10_000 - chosen) + 9_999n) / 10_000n
  if (sell) {
    const [balance, allowance] = await Promise.all([
      client.readContract({ address: sellAddress, abi: erc20Abi, functionName: 'balanceOf', args: [from] }),
      client.readContract({ address: sellAddress, abi: erc20Abi, functionName: 'allowance', args: [from, router] }),
    ])
    if (balance < input) throw new Error(`Insufficient ${sell.symbol} to cover this swap.`)
    if (allowance < input) {
      const approval = allowance > 0n ? 0n : input
      return quoteEvm(network, client, from, {
        to: sellAddress, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [router, approval] }),
      }, { to: router, value: formatAmount(approval, sell.decimals), asset: sell.id, kind: 'approval' })
    }
  }
  const deadline = BigInt(Math.floor(Date.now() / 1_000) + 120)
  const args = [minimum, best.path, from, deadline] as const
  const data = !sell
    ? encodeFunctionData({ abi: routerAbi, functionName: 'swapExactETHForTokens', args })
    : encodeFunctionData({ abi: routerAbi, functionName: buy ? 'swapExactTokensForTokens' : 'swapExactTokensForETH', args: [input, ...args] })
  return quoteEvm(network, client, from, { to: router, value: sell ? 0n : input, data }, {
    to: router, value: display, asset: sell?.id, kind: 'swap',
    receive: { amount: formatAmount(best.output, outputDecimals), minimum: formatAmount(minimum, outputDecimals), symbol: buy?.symbol ?? network.symbol, slippage: chosen, auto: !slippage, impact },
  })
}
