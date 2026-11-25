import { sessionFor } from './vault'

// Making a wallet's addresses takes a moment. Here it doesn't hold up taps or animations.
self.onmessage = async ({ data }: MessageEvent<{ id: number; vault: string; mnemonic: string; account: number; root: string; slot: number }>) => {
  try {
    postMessage({ id: data.id, session: await sessionFor(data.vault, data.mnemonic, data.account, data.root, data.slot) })
  } catch (problem) {
    postMessage({ id: data.id, error: problem instanceof Error ? problem.message : 'Still could not open this wallet.' })
  }
}
