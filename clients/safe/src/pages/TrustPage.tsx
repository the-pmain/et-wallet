import { ArrowLeft, Globe, KeyRound, ListChecks, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router'

import { APP_CONFIG } from '@/shared/config'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui'

/**
 * What you have to trust when using a wallet in the browser.
 *
 * WHY A SEPARATE SCREEN. Everything else in the wallet protects funds
 * from other people's actions: encryption, confirmations, recipient
 * warnings. This page is about what the wallet cannot protect at all —
 * trust in whoever serves its code. Staying silent would promise a
 * kind of safety a web app does not have.
 *
 * WHY NOT A SECOND WARNING ON THE FIRST SCREEN. That screen already
 * warns about the seed phrase, and that warning matters more at that
 * moment: the person is creating a wallet. Two blocks of equal weight
 * compete for attention, and the reader skips both.
 *
 * THERE IS NO "DO NOT USE THIS" CALL. The risk, its size, and what to
 * do about it are named. The owner of the funds decides; the wallet
 * must inform, not choose for them.
 */
export function TrustPage() {
  return (
    <div className="mx-auto flex min-h-svh max-w-xl flex-col gap-4 p-5">
      <header className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to="/">
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">What you are trusting</h1>
      </header>

      <Alert variant="warning">
        <ShieldAlert />
        <AlertTitle>A web wallet trusts whoever serves it</AlertTitle>
        <AlertDescription>
          The code of {APP_CONFIG.name} is downloaded from a server every time you open the page. If
          that server or the domain is taken over, the replaced code can collect the seed phrase of
          everyone who opens it — and no encryption inside the wallet prevents that, because the
          replaced code is the wallet.
        </AlertDescription>
      </Alert>

      {/*
        THE THREE SECTIONS MEAN OPPOSITE THINGS AND MUST LOOK DIFFERENT.

        "What is protected", "what cannot be protected", and "how to
        reduce the risk" used to be three identical cards in a row.
        The page exists so the owner can hold a threat model in mind;
        identical blocks flatten that model into a wall of text with
        no visible boundary.

        Colors come from the semantic risk scale and are doubled by an
        icon in the heading: color alone is unavailable to people with
        impaired color vision.
      */}
      <Card className="border-risk-low/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 shrink-0 text-risk-low" aria-hidden />
            What the wallet does protect
          </CardTitle>
          <CardDescription>These hold as long as the code you run is genuine</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex gap-3">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <p>
              Keys and the seed phrase never leave the device and are stored encrypted with your
              password. No server of ours receives them — there is no server of ours at all.
            </p>
          </div>

          <div className="flex gap-3">
            <Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <p>
              Nodes and price sources see the addresses they are asked about, not your keys. Every
              request that reveals something is either your explicit action or is announced in
              advance.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-risk-high/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="size-4 shrink-0 text-risk-high" aria-hidden />
            What it cannot protect
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>
            <span className="font-medium">A compromised site or domain.</span> The replaced code
            runs with the same rights as the original one: it can show you a different recipient,
            sign in the background, or simply send the phrase you type away.
          </p>
          <p>
            <span className="font-medium">A malicious browser extension.</span> Extensions with
            access to the page can read what is on screen and replace the contents of the clipboard
            — this is why the wallet asks you to compare addresses character by character.
          </p>
          <p>
            <span className="font-medium">A phishing copy.</span> A page that looks the same at a
            similar address is indistinguishable from the inside. Only the address bar tells them
            apart.
          </p>
        </CardContent>
      </Card>

      <Card className="border-primary/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="size-4 shrink-0 text-primary-emphasis" aria-hidden />
            How to reduce the risk
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>
            Open the wallet from your own bookmark, not from search results or a link in a message.
          </p>
          <p>
            Keep here only what you are prepared to lose. Large amounts belong in a hardware wallet,
            where the key never reaches the browser at all.
          </p>
          <p>
            Keep the seed phrase on paper. It restores the wallet in any BIP-39 compatible
            application — including one that has nothing to do with this site.
          </p>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        This applies to every wallet that runs as a web page, not only to this one. Browser
        extensions are installed once and are not re-downloaded on each opening, which is why they
        are the usual form for wallets.
      </p>
    </div>
  )
}
