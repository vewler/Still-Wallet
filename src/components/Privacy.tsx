import { useState, type Ref } from 'react'
import { ArrowLeft, ChevronDown } from 'lucide-react'
import { Slot } from './Dialog'
import { Brand } from './Icons'
import { credits, dataSources, supporters, team } from '../credits'
import './landing.css'
import { t, tx } from '../i18n'

const updated = 'November 26, 2026'

/** Privacy policy. Keep in sync with what the app does. */
export function PrivacyPolicy({ mainRef, back }: { mainRef: Ref<HTMLElement>; back: string }) {
  return <div className="landing">
    <header className="landing-header">
      <div className="landing-container landing-header-inner">
        <a className="landing-brand" href="/" aria-label={t('Still home')}><Brand /></a>
        <a className="button secondary landing-button" href={back}><ArrowLeft size={16} /> {t('Back')}</a>
      </div>
    </header>

    <main id="main-content" ref={mainRef} tabIndex={-1} className="landing-main landing-container policy">
      <h1>{t('Privacy Policy')}</h1>
      <p className="policy-updated">Last updated {updated}</p>

      <p>Still Wallet (“Still”) is a self-custody crypto wallet made by ow2 and developed by vewler. You can use Still without an account. Your recovery phrase and wallet password stay on your device.</p>

      <h2>What we collect</h2>
      <p>Still has no sign-up, analytics, ads, trackers or crash reporting. The Still RPC gateway forwards network requests and does not save wallet data. Your hosting provider may retain standard access logs.</p>

      <h2>What stays on your device</h2>
      <p>Still saves the following in your browser’s local storage, on your device only:</p>
      <ul>
        <li>Your recovery phrase, encrypted with your password (AES-256-GCM, key derived with PBKDF2 using 600,000 rounds). It is never sent anywhere.</li>
        <li>Your Home coins and their order, imported and found tokens, the address book, and a history of transactions submitted from Still so Activity can show their status. These are encrypted with a key from your recovery phrase.</li>
        <li>Wallet names and emojis, your settings (such as hidden balances, currency, auto-lock, account protection and custom RPC addresses), the last prices of listed coins, and a count of wrong password attempts if account protection is on. These aren’t encrypted, so anyone with access to this device can read them, but they don’t show what your wallets hold.</li>
      </ul>
      <p>Your password isn’t stored. If you forget it, nobody can recover it. You can erase everything with <strong>Settings → Delete wallet</strong>, or by clearing this site’s data in your browser.</p>

      <h2>Services Still connects to</h2>
      <p>Still uses chain providers and market data services. Their privacy policies apply.</p>
      <ul>
        <li><strong>Network servers.</strong> The Still host forwards requests to the configured providers. It can see your IP address and request contents. Providers can see the wallet addresses, swap quotes, and signed transactions in those requests. If you set a custom RPC under <strong>Networks</strong>, it receives requests and your IP address directly. You can pause requests in <strong>Settings</strong>.</li>
        <li><strong>Helius.</strong> The Still host forwards Solana requests to Helius. Those requests can contain your Solana address and signed transactions, but not your IP address.</li>
        <li><strong>WalletConnect.</strong> Only if you connect an app under <strong>Connected apps</strong>. Your device then talks to the WalletConnect relay directly, so it sees your IP address. Messages between Still and the app are end-to-end encrypted. Still turns off WalletConnect analytics.</li>
        <li><strong>CoinGecko.</strong> The Still host requests public market data using token identifiers, currency, and chart ranges. Those requests contain no wallet addresses.</li>
      </ul>

      <h2>Public blockchains</h2>
      <p>Transactions you send are recorded on a public blockchain. Anyone can see them, and they can’t be changed or deleted.</p>

      <h2>Hosting and offline use</h2>
      <p>The server that delivers the Still app files may keep standard access logs (such as IP address and time of request), as almost every website does. Still installs a service worker so it can load offline. It only caches the app’s own files.</p>

      <h2>Your responsibility and no warranty</h2>
      <p>You alone control your wallet. Keep your recovery phrase safe: anyone who has it can take your funds, and without it lost access can’t be restored. Still is open-source software provided “as is”, without warranty of any kind, under the MIT License. It hasn’t had an independent security audit. ow2 and its contributors aren’t liable for lost funds, mistaken transfers, network fees or third-party services. Still is not a bank or exchange and doesn’t give financial advice.</p>

      <h2>Children</h2>
      <p>Still isn’t made for children under 13, and we don’t knowingly collect information from anyone.</p>

      <h2>Changes</h2>
      <p>If this policy changes, the new version will be posted here with a new date.</p>

      <h2>Contact</h2>
      <p>Questions? DM <strong>@vewler</strong> on Discord.</p>
    </main>

    <footer className="landing-footer landing-container">
      <span><strong>Still</strong></span>
      <a href="/LICENSE.txt" target="_blank" rel="noreferrer">{t('MIT License')}</a>
    </footer>
  </div>
}

/** Credits page (footer link). */
export function CreditsPage({ mainRef, back }: { mainRef: Ref<HTMLElement>; back: string }) {
  return <div className="landing">
    <header className="landing-header">
      <div className="landing-container landing-header-inner">
        <a className="landing-brand" href="/" aria-label={t('Still home')}><Brand /></a>
        <a className="button secondary landing-button" href={back}><ArrowLeft size={16} /> {t('Back')}</a>
      </div>
    </header>

    <main id="main-content" ref={mainRef} tabIndex={-1} className="landing-main landing-container policy">
      <h1>{t('Credits')}</h1>
      <p>{t('Still Wallet by ow2')}. {t('Open source under the MIT License.')}</p>

      <h2>{t('Made by')}</h2>
      <ul className="credits-page-list">
        {team.map(([name, role]) => <li key={name}><span>{name}<br /><small>{t(role)}</small></span></li>)}
      </ul>

      <h2>{t('Supported by')}</h2>
      <ul className="credits-page-list">
        {supporters.map(([name, role]) => <li key={name}><span>{name}<br /><small>{t(role)}</small></span></li>)}
      </ul>

      <h2>{t('Built with')}</h2>
      <ul className="credits-page-list">
        {credits.map(([name, license, use]) => <li key={name}><span>{name}<br /><small>{t(use)}</small></span><em>{license}</em></li>)}
      </ul>
      <p>{t('Thanks to everyone who maintains these projects.')}</p>

      <h2>{t('Data from')}</h2>
      <ul className="credits-page-list">
        {dataSources.map(([name, kind, use]) => <li key={name}><span>{name}<br /><small>{t(use)}</small></span><em>{t(kind)}</em></li>)}
      </ul>
    </main>

    <footer className="landing-footer landing-container">
      <span><strong>Still</strong></span>
      <a href="/LICENSE.txt" target="_blank" rel="noreferrer">{t('MIT License')}</a>
    </footer>
  </div>
}

const faq: [question: string, answer: string][] = [
  ['What is Still?', 'A self-custody crypto wallet that runs in your browser. There is no account or email: your wallet is a recovery phrase that only you hold.'],
  ['Where are my keys kept?', 'On this device only. Your recovery phrase is encrypted with your password (AES-256-GCM, key derived with PBKDF2 using 600,000 rounds) and saved in this browser. It is never sent anywhere.'],
  ['I forgot my password. What now?', 'Use “Forgot password” on the lock screen and enter your recovery phrase. If it matches, you pick a new password and keep everything. Nobody else has your password, so without the phrase the only way back in is to delete the wallet and import it again.'],
  ['What if I lose my recovery phrase?', 'Nobody can recover it for you. If you lose the phrase and this browser’s data is cleared or the device is lost, the funds are gone. Write it down on paper and keep it somewhere private.'],
  ['Which networks are supported?', 'Bitcoin, Ethereum, Solana, XRP Ledger, BNB Chain, HyperEVM and Base, all on mainnet, plus popular stablecoins and other tokens on Ethereum, Solana and Base.'],
  ['Does Still charge fees?', 'No. You only pay the network fee, which is shown on the review screen before you sign.'],
  ['How do swaps work?', 'Swaps use Uniswap v2 on Ethereum and Base. You choose the max slippage (0.5% to 3%), and Still warns you when a swap is big enough to move the price.'],
  ['Can I use my own RPC?', 'Yes. Open Networks in Settings and add a custom RPC URL for any network. Leave it blank to use the Still gateway.'],
  ['What does account protection do?', 'When it’s on, five wrong passwords in a row erase the wallet from this device. Only turn it on if your recovery phrase is backed up.'],
  ['Does Still track me?', 'No. There are no analytics, ads or trackers. The Privacy Policy lists what gets stored and what gets sent.'],
  ['Is Still open source?', 'Yes, under the MIT License.'],
]

/** FAQ, answers animate open/closed. */
export function FaqPage({ mainRef, back }: { mainRef: Ref<HTMLElement>; back: string }) {
  const [open, setOpen] = useState<number>()
  return <div className="landing">
    <header className="landing-header">
      <div className="landing-container landing-header-inner">
        <a className="landing-brand" href="/" aria-label={t('Still home')}><Brand /></a>
        <a className="button secondary landing-button" href={back}><ArrowLeft size={16} /> {t('Back')}</a>
      </div>
    </header>

    <main id="main-content" ref={mainRef} tabIndex={-1} className="landing-main landing-container policy">
      <h1>{t('FAQ')}</h1>
      <ul className="faq-list">
        {faq.map(([question, answer], index) => <li key={question} className={open === index ? 'open' : undefined}>
          <button type="button" aria-expanded={open === index} onClick={() => setOpen(open === index ? undefined : index)}>{t(question)}<ChevronDown size={18} /></button>
          <Slot open={open === index}><p>{t(answer)}</p></Slot>
        </li>)}
      </ul>
      <p>{tx('Still stuck? DM {name} on Discord.', { name: <strong>@vewler</strong> })}</p>
    </main>

    <footer className="landing-footer landing-container">
      <span><strong>Still</strong></span>
      <a href="/LICENSE.txt" target="_blank" rel="noreferrer">{t('MIT License')}</a>
    </footer>
  </div>
}

/** Unknown paths, and wallet pages opened with no wallet on this device. */
export function ErrorPage({ mainRef, kind }: { mainRef: Ref<HTMLElement>; kind: 'missing' | 'denied' }) {
  const [code, title, text] = kind === 'missing' ? ['404', 'Page not found', 'This page doesn’t exist or has moved.'] : ['403', 'No access', 'You can’t open this without a wallet on this device. Create or import one first.']
  return <div className="landing">
    <header className="landing-header">
      <div className="landing-container landing-header-inner">
        <a className="landing-brand" href="/" aria-label={t('Still home')}><Brand /></a>
      </div>
    </header>

    <main id="main-content" ref={mainRef} tabIndex={-1} className="landing-main landing-container policy not-found">
      <div className="error-code" aria-hidden="true">{code}</div>
      <h1>{t(title)}</h1>
      <p>{t(text)}</p>
      <a className="button primary landing-button landing-button--big" href="/"><ArrowLeft size={18} /> {t('Back to Still')}</a>
    </main>

  </div>
}
