import { ExternalLink, Images, ShieldAlert } from 'lucide-react'

import { useWalletSnapshot } from '@/features/wallet'
import { Alert, AlertDescription, Button, Card, CardContent, EmptyState } from '@/shared/ui'

/**
 * Коллекционные токены.
 *
 * ПОДДЕРЖКА ERC-721 И ERC-1155 НЕ РЕАЛИЗОВАНА. Страница существует
 * как готовый каркас: разметка, навигация и переходы работают, подключение
 * данных сведётся к замене пустого состояния списком.
 *
 * ПОЧЕМУ ЗДЕСЬ НЕТ ПРИМЕРОВ КАРТИНОК. Изображение в галерее кошелька
 * читается как «этот предмет принадлежит вам». Демонстрационное
 * содержимое на этом экране — прямая дезинформация о составе имущества.
 *
 * ОТДЕЛЬНО О БУДУЩЕЙ РЕАЛИЗАЦИИ. Изображения NFT лежат по ссылкам,
 * которые задаёт автор контракта. Загрузка их напрямую раскроет IP-адрес
 * пользователя владельцу произвольного сервера и позволит связать адрес
 * кошелька с посещением. Это требует прокси либо явного согласия
 * и должно быть решено до появления галереи, а не после.
 */
export function NftPage() {
  const snapshot = useWalletSnapshot()
  const explorer = snapshot.activeNetwork?.blockExplorerUrls[0] ?? null
  const address = snapshot.activeAccount?.address ?? null

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">NFT</h1>
      </header>

      <Card>
        <CardContent>
          <EmptyState
            icon={Images}
            title="Коллекционные токены пока не поддержаны"
            description={
              <>
                Кошелёк не читает ERC-721 и ERC-1155. Пустой экран означает, что кошелёк не умеет их
                показывать, а не что коллекции нет. Проверить принадлежащие адресу предметы можно в
                обозревателе блоков.
              </>
            }
            action={
              explorer === null || address === null ? undefined : (
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`${explorer}/address/${address}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    <ExternalLink className="size-4" aria-hidden />
                    Открыть в обозревателе
                  </a>
                </Button>
              )
            }
          />
        </CardContent>
      </Card>

      <Alert variant="warning">
        <ShieldAlert />
        <AlertDescription>
          Когда галерея появится, изображения будут загружаться по ссылкам из контрактов. Владелец
          такой ссылки видит IP-адрес и связывает его с вашим кошельком, поэтому загрузка будет
          выключена по умолчанию.
        </AlertDescription>
      </Alert>
    </div>
  )
}
