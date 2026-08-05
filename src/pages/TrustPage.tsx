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
 * Чему приходится доверять, пользуясь кошельком в браузере.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ЭКРАН. Всё остальное в кошельке защищает средства
 * от чужих действий: шифрование, подтверждения, предупреждения
 * о получателе. Здесь речь о том, чего кошелёк защитить не может
 * в принципе, — о доверии к тому, кто раздаёт его код. Умолчать об этом
 * значило бы обещать безопасность, которой у веб-приложения нет.
 *
 * ПОЧЕМУ НЕ ВТОРЫМ ПРЕДУПРЕЖДЕНИЕМ НА ПЕРВОМ ЭКРАНЕ. Там уже стоит
 * предупреждение о seed-фразе, и оно важнее в тот момент: человек
 * создаёт кошелёк. Два блока одинакового веса рядом соперничают
 * за внимание, и читатель пропускает оба.
 *
 * ЗДЕСЬ НЕТ ПРИЗЫВА «НЕ ПОЛЬЗУЙТЕСЬ». Названы риск, его величина
 * и то, что с ним делать. Решение принимает владелец средств; кошелёк
 * обязан дать ему сведения, а не выбирать за него.
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
        ТРИ РАЗДЕЛА СТРАНИЦЫ ОЗНАЧАЮТ ПРОТИВОПОЛОЖНОЕ И ОБЯЗАНЫ
        РАЗЛИЧАТЬСЯ НА ВИД.

        Прежде «что защищено», «чего защитить нельзя» и «как снизить
        риск» шли тремя одинаковыми карточками подряд. Страница
        существует ради того, чтобы владелец удержал в голове модель
        угрозы, а одинаковые блоки эту модель сглаживают: читается
        сплошной текст, из которого не видно, где граница защищённого.

        Цвета взяты из смысловой шкалы риска и продублированы значком
        в заголовке: цвет как единственный признак недоступен людям
        с нарушением цветовосприятия.
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
