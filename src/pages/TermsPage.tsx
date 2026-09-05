import { APP_CONFIG } from '@/shared/config'
import { LegalPageLayout, LegalSection } from '@/shared/ui/legal-page-layout'

/**
 * Terms of use.
 *
 * For a non-custodial wallet the core is the disclaimer on restoring
 * access and the warning about blockchain risk.
 */
export function TermsPage() {
  return (
    <LegalPageLayout title="Terms of service">
      <p className="text-foreground">
        By using {APP_CONFIG.name}, you agree to these terms. If you do not agree, do not use the
        wallet.
      </p>

      <LegalSection title="Non-custodial service">
        <p>
          {APP_CONFIG.name} is a self-custody software tool. We do not hold, control, or have access
          to your cryptocurrency, private keys, or seed phrase. Transactions you initiate are
          irreversible on the blockchain; we cannot cancel, reverse, or recover them.
        </p>
      </LegalSection>

      <LegalSection title="No recovery guarantee">
        <p>
          Your seed phrase is the only way to restore your wallet. We do not store it and cannot
          help you recover it if lost. Your device password encrypts the wallet locally only — it
          does not replace the seed phrase and cannot restore access on a new device.
        </p>
        <p>
          No support representative will ever ask for your seed phrase or private keys. Any such
          request is a scam.
        </p>
      </LegalSection>

      <LegalSection title="Your responsibilities">
        <ul className="list-disc space-y-1 pl-5">
          <li>Write down and securely store your seed phrase before using the wallet</li>
          <li>Verify recipient addresses character by character before sending funds</li>
          <li>Review every transaction and signing request before approving it</li>
          <li>Keep only amounts you are prepared to lose in a browser-based wallet</li>
          <li>Ensure you are using the genuine application from a trusted source</li>
        </ul>
      </LegalSection>

      <LegalSection title="Risks">
        <p>
          Cryptocurrency involves substantial risk, including total loss of funds. Smart contract
          interactions, token approvals, phishing sites, and compromised devices can result in
          theft. Blockchain transactions are public and permanent. You use the wallet at your own
          risk.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>
          You may not use {APP_CONFIG.name} for illegal activity, money laundering, sanctions
          evasion, or any purpose prohibited by applicable law. We may restrict access where
          required by law.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimer of warranties">
        <p>
          The wallet is provided &quot;as is&quot; without warranties of any kind. We do not
          guarantee uninterrupted operation, accurate price data, or compatibility with every network
          or token. Third-party services (nodes, price feeds, dApps) are outside our control.
        </p>
      </LegalSection>

      <LegalSection title="Limitation of liability">
        <p>
          To the fullest extent permitted by law, we are not liable for any loss of funds, data, or
          profits arising from your use of the wallet, including user error, forgotten passwords,
          lost seed phrases, phishing, smart contract bugs, or network failures.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          These terms may be updated from time to time. Continued use after changes constitutes
          acceptance of the revised terms.
        </p>
        <p className="text-xs">Last updated: September 2025</p>
      </LegalSection>
    </LegalPageLayout>
  )
}
