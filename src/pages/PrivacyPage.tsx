import { APP_CONFIG } from '@/shared/config'
import { LegalPageLayout, LegalSection } from '@/shared/ui/legal-page-layout'

/**
 * Privacy policy.
 *
 * Describes which data may leave the device and which may not. For a
 * non-custodial wallet that matters more than a "what we collect" list:
 * keys and the seed phrase are deliberately never sent anywhere.
 */
export function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy policy">
      <p className="text-foreground">
        {APP_CONFIG.name} is a non-custodial wallet. Your private keys and seed phrase are encrypted
        on your device and are never transmitted to us or stored on our servers.
      </p>

      <LegalSection title="What stays on your device">
        <p>
          Your seed phrase, private keys, encrypted wallet file, account names, and security settings
          remain in your browser&apos;s local storage. We cannot read, copy, or recover them.
        </p>
      </LegalSection>

      <LegalSection title="What may leave your device">
        <p>
          When you use the wallet, certain requests are sent to third-party services that the app
          depends on:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <span className="text-foreground">Blockchain nodes</span> — to read balances, broadcast
            transactions, and estimate fees. Nodes see the addresses you query, not your keys.
          </li>
          <li>
            <span className="text-foreground">Price and market data providers</span> — to show
            approximate fiat values and public market prices. These requests do not include your
            wallet addresses unless you explicitly perform an action that requires it.
          </li>
          <li>
            <span className="text-foreground">WalletConnect relay</span> — when you connect to a
            dApp, session metadata and signing requests pass through the relay. The relay does not
            receive your keys.
          </li>
          <li>
            <span className="text-foreground">Account directory</span> — if you sign in with email,
            your email address is stored on our server to identify your account. Your password
            encrypts the wallet locally; we do not store it in a recoverable form.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="What we do not do">
        <ul className="list-disc space-y-1 pl-5">
          <li>Store, access, or recover your seed phrase or private keys</li>
          <li>Track your portfolio across sessions for advertising</li>
          <li>Sell personal data to third parties</li>
          <li>Use analytics that fingerprint your browser for marketing</li>
        </ul>
      </LegalSection>

      <LegalSection title="Cookies and local storage">
        <p>
          The wallet uses browser local storage to persist your encrypted wallet and preferences.
          No third-party advertising cookies are set. Session tokens for email sign-in are stored
          locally and expire according to your security settings.
        </p>
      </LegalSection>

      <LegalSection title="Your responsibilities">
        <p>
          Anyone with access to your device or browser profile can access an unlocked wallet.
          Clearing browser data without a saved seed phrase permanently destroys access to your
          funds. Keep your seed phrase offline and treat your device password as you would a bank
          PIN.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          This policy may be updated as the product evolves. Material changes will be reflected in
          the date below. Continued use of the wallet after an update constitutes acceptance of the
          revised policy.
        </p>
        <p className="text-xs">Last updated: September 2025</p>
      </LegalSection>
    </LegalPageLayout>
  )
}
