# Full ETWallet Audit

**Date:** August 3, 2026. **Revision:** `ee0644d`.
**Relationship to the previous audit:** This document replaces the Stage 25 report
in its entirety and takes into account the work of Stage 26 – transaction monitoring, replacing
stuck transactions, sending ERC-20s, and collectible tokens.

All numbers in the report are **measured**, not estimated. Replay commands
are listed next to the metrics.

---

## One-page summary

| Focus | Rating | Main |
| --- | --- | --- |
| Security | **good, with one defect** | Discrepancy found between the displayed data and the dApp being signed in transit (S-62). Cryptography, secret storage, and signature – no issues |
| Architecture | **good** | Layers are separated and checked by a linter; two nodes have grown to the limit of manageability |
| Performance | **acceptable** | Initial load 202 KB gzip; history reading is linear and already noticeable at 500 records |
| Scalability | **limited** | Storage without indices, RPC without batching and deduplication |
| Code Quality | **high** | 1602 tests, 87.58% coverage, 'any' — zero, two linter suppressions, both justified |
| Wallet Practices | **three things missing** | No permission management, no list of verified contracts, no hardware wallets |

**Suitability Verdict.** The wallet is suitable for testnets
and small amounts on the mainnet. For assets whose loss is
sensitive, not ready: S-62 is not closed, there is no management of issued
permissions (S-54), and no list of verified contracts (S-38).

---

## 1. What was measured

```bash
npm run verify # format, linter, types, 1602 tests
npx playwright test # 20 end-to-end checks in Chromium
npm audit # 0 vulnerabilities
npm run build # chunk sizes
```

| Metric | Value | Was (stage 25) |
| --- | --- | --- |
| Lines of code (`src` + `e2e`) | 59,258 | ~52,000 |
| Unit and integration tests | 1602 | 1495 |
| End-to-end tests | 20 | 19 |
| Statement Coverage | 87.58% | 86.73% |
| Branch Coverage | 77.55% | — |
| Bootstrap | 202.1 KB gzip | 190.6 KB gzip |
| Dependency Vulnerabilities | 0 | 0 |
| Direct Dependencies | 17 | 17 |
| Technical Debt Items | 193 (155 Open) | 165 |

The bootstrap consists of six files: `index` 172.4 KB,
`Address` 16.3 KB, CSS 10.0 KB, `utils` 1.7 KB, `ErrorCode` 1.1 KB,
runtime 0.5 KB. An 11.5 KB increase is the price of three new features in Stage 26.

---

## 2. Security

### 2.1 Defect: dApp may sign something other than what is shown (S-62, high)

**Where:** [WalletSession.ts:846](src/features/wallet/model/WalletSession.ts:846).

```ts
to: payload.transaction.to ?? payload.transaction.from,
```

**What's happening:** The application sends a transaction without a recipient—
by default, this is a contract deployment. The wallet recognizes this case
and displays a warning "creating a contract"
([request-risk.ts](src/core/dapp/request-risk.ts), `ContractDeployment`).
However, upon execution, it substitutes the **sender's** address in the `to` field.

**Consequences.** Something other than the user's approved contract is signed:
instead of deploying the contract, the user transfers it to themselves with the bytecode
in the call data. The funds don't go to the other party, but the gas is debited in full, and the operation the user approved isn't executed. This is
exactly the type of discrepancy that the other
wallet screens are designed to prevent.

**How ​​to fix.** Pass `to: null` to `prepare`—it supports this
(`#estimateGasLimit` handles the deployment case separately). Or,
if contract deployment isn't part of the wallet's functionality, reject
such a request at the outset with a clear refusal. The latter is more honest: deployment
from the wallet is rare, and supporting an unverified path is more expensive than a refusal.

### 2.2 Cryptography — no comments

Verified by reading all points where primitives occur:

| Operation | What is performed | Custom implementation |
| --- | --- | --- |
| Key derivation from password | `crypto.subtle` PBKDF2-SHA-256, 600,000 iterations | no |
| Storage encryption | `crypto.subtle` AES-256-GCM, `extractable: false` | no |
| Randomness | `crypto.getRandomValues` | no |
| secp256k1 | `@noble/curves` via `SigningKey` ethers | no |
| keccak256 | `@noble/hashes` | no |
| BIP-32/39 | `@scure/bip32`, `@scure/bip39` | no |
| RLP, EIP-2718, EIP-712 | ethers | no |

There are no two independent secp256k1 implementations in a single application:
the address module and signature module use the same library.

The salt and IV are generated for each operation; the IV is never reused.
(In AES-GCM, repeating a key + IV pair reveals both the contents and the key.)
The number of iterations during decryption is checked against the minimum—lowering
parameters by an attacker who has gained access to the storage file
does not work.

### 2.3 Signature — three checks, each covering a different class of attacks.

[SigningService.ts](src/core/signing/SigningService.ts):

1. **`chainId > 0`** — a transaction without it is signed according to the format
before EIP-155 and is valid on all EVM networks simultaneously. A transfer
signed on the testnet is repeated on the mainnet.
2. **The address from the key is checked against `from`** — Otherwise, the signature will be passed with someone else's
key, and the funds will be transferred from an account other than the one shown.
3. The **`chainId`` of the EIP-712 structure is verified against the active network** before creating a
key: invalid data does not reach the cryptography.

### 2.4 Storing Secrets

| What | Where | How |
| --- | --- | --- |
| Seed phrase | `vault` | AES-256-GCM |
| Imported keys | `vault` | AES-256-GCM |
| Account addresses and names | `accounts` | AES-256-GCM |
| Tracked tokens | `tokens` | AES-256-GCM |
| Transaction history | `transactions` | AES-256-GCM |
| Network configurations, including node addresses | `networks-encrypted` | AES-256-GCM (stage 28) |
| Settings, active network selection | `settings` | **open** |

Open storage of network configurations is a deliberate compromise: they
are needed until unblocking. However, the list of user RPC addresses is stored
in the same place, and such an address can contain the access key directly in the URL.
**Recommendation:** Move user addresses to encrypted
space, leaving the built-in ones open.

`localStorage` and `sessionStorage` are prohibited by the linter at the global
name level—not by convention, but by a rule that cannot be bypassed.

### 2.5 Browser Perimeter

CSP from the build (tested in `dist/index.html`):

```
default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self';
form-action 'none'; frame-src 'none'; worker-src 'none'; child-src 'none';
require-trusted-types-for 'script'; connect-src 'self' https:
```

`script-src 'self'` without `unsafe-inline` and `unsafe-eval`; `eval`,
`new Function`, and `innerHTML` are prohibited by the linter; source maps
are not included in the build. `connect-src https:` remains wide - this is S-1, an open
debt record: narrowing it to specific RPC domains is prevented by the ability
to add a custom node.

`Referrer-Policy: no-referrer` is set.

### 2.6 Logs

Default level is `warn`. All kernel logger calls have been checked:
addresses, amounts, phrases, and keys are not included in the context; the `chainId`,
the reason for refusal, and the account serial number are written. `console.*` is missing from the production code.

### 2.7 The `eth_sign` method is accepted (S-63, medium)

[request-mapping.ts](src/features/dapp/model/request-mapping.ts) processes
`eth_sign` equally as `personal_sign`. Historically, this is a very dangerous method:
it is intended as a signature for an arbitrary 32-byte hash, and an application
can spoof the transaction hash.

**No actual breach:** the signature still goes via `hashMessage`
with the EIP-191 prefix, so the result isn't a raw hash signature
and isn't suitable for spoofing a transaction. However, this is a specification non-compliance,
working in a secure direction by coincidence, not by design.

**Recommendation:** reject `eth_sign` at input. MetaMask disabled it
by default, and then removed it; others followed suit.

### 2.8 What's missing in the protection

| Space | Debt | Why is it important |
| --- | --- | --- |
| Managing issued permissions | S-54 | The main way token theft today isn't key theft, but a forgotten `approve` with no amount limit. The wallet warns upon issuance, but can't display or revoke issued ones |
| List of verified contracts | S-38, S-51 | The token symbol is set by the contract author; real USDC can only be distinguished from counterfeit by the address, and the user must verify it visually |
| List of phishing domains | no entry | Connecting to a fake site is no different from connecting to a real one |
| Hardware wallets | extension point present, no implementation | The key resides in the tab's memory; this is unacceptable for large amounts |
| Transaction simulation | no entry | The user sees the call data, but not the consequences. `OpaqueCallData` honestly says "the meaning is unclear" - that's not enough |

The first two are what separate a training wallet from a working one.

---

## 3. Architecture

### 3.1 Layers are respected

```
shared ← core ← features ← pages ← app
```

Boundaries are checked by ESLint's `no-restricted-imports`, not by convention.
`core` does not import React and DOM—this is a portability requirement
in the MV3 extension's service worker, and it is implemented in practice, not just in words.

The core is 35,822 lines, 60% of the code. The interface is thin: pages read a single snapshot and call session methods.

### 3.2 Two nodes at the limit of manageability (A-122, medium)

| File | Strings | Public methods | Private fields |
| --- | --- | --- | --- |
| `WalletSession.ts` | 1565 | 34 | 27 |
| `TransactionService.ts` | 1001 | 14 | — |

`WalletSession` owns all session services and all data paths
of the interface: accounts, networks, balances, tokens, history, NFTs, rates, ENS,
RPC, application requests, and the preparation of four types of transactions. It's not yet a God Object—it has a single, clear responsibility ("the lifetime of an unlocked
session"), but the next feature will make it so.

**Recommendation:** separate three facades from the session by data areas
(assets, history, transactions), leaving the session with ownership of the lifetime
and snapshot publishing. Do this until the next major feature,
not after.

`TransactionService` has grown by adding four preparation paths (regular,
token, item,, replacement) and tracking. Tracking is a separate
function with its own timer and state; it should be moved
to `TransactionTracker`.

### 3.3 Duplicate ABI encoding (A-123, medium)

`WORD_LENGTH`, `ADDRESS_LENGTH`, `MAX_UINT256`, and reading an address from a word
are declared twice: in [erc20.ts](src/core/token/erc20.ts) and
in [nft/abi.ts](src/core/nft/abi.ts). The logic for checking for high-order zero bytes
is repeated in `decodeTransfer` and `decodeSafeTransferRecipient`.

This isn't cosmetic: a discrepancy between the two copies of the address check results in
an incorrect recipient being displayed on the confirmation screen.

**Recommendation:** Separate `core/abi` with encoding primitives, leaving only the knowledge of standards in the token and item modules.

### 3.4 What's Done Right

- **The core doesn't sign or store keys** — `Keyring` handles that;
the transaction layer receives the completed signature.
- **Single path to signature.** Application requests go through the same
`prepare` as sending from the wallet: a second path would mean a second
point where checks could be forgotten.
- **Branded types** (`Address`, `Wei`, `ChainId`, `TxHash`)
prevent value confusion: `Wei` cannot be obtained by type casting,
only via `toWei` with a range check.
- **Snapshot instead of getters** — `useSyncExternalStore` compares by reference,
and screen integrity is inferred from the device, not the discipline.
- **Unknown is not replaced by zero** — the following are performed sequentially:
balance, exchange rate, token digit count, storage durability, and ownership of
the item. This is the main difference between this project and a typical implementation.

---

## 4. Performance

### 4.1 Initial Load

202.1 KB gzip. Lazy chunks include: ENS normalization, WalletConnect
(437 KB → 131 KB gzip, loaded only upon connection), EIP-712, RPC client,
all screens except the main one.

The collector's warning about a chunk larger than 500 KB refers to the `index`
before compression; after gzip, it is 172 KB.

### 4.2 Measured issue: linear history reading (A-124, high)

Measurement on real encryption (`EncryptionService`, not a stand-in):

| Storage records | One `findByAddress` read |
| --- | --- |
| 100 | 8.4 ms |
| 500 | 69.6 ms |

Linear growth, ≈0.14 ms per write. Cause: `#readAll()`
in [TransactionRepository.ts:157](src/core/transaction/TransactionRepository.ts:157):
all records are read one at a time and decrypted on **every** call.

This isn't a one-time call: transaction tracking triggers
`findUnsettled` **every 12 seconds**, and it also reads everything. With 500
records, this is 70 ms of work every 12 seconds; with 2000, it's almost 300 ms.

**Recommendation:** Store the "address + network → hashes" index in a separate key
and read only the required records; or switch to IndexedDB indexes
(encryption doesn't interfere: indexing can be done by open envelope fields).
The latter is more correct, but requires migration.

### 4.3 Network layer without batching and deduplication (A-125, medium)

Tested: there are no "in-flight" request maps, no deduplication of identical requests, and no JSON-RPC batch in the project.

Consequences measurable in number of requests:

- token list — one `balanceOf` per token;
- item search — 3 log selections plus up to 60 contract calls
in waves of 8;
- Parallel screens (main and portfolio) request the same balance twice if the interval is greater than 15 seconds of cache freshness.

Public nodes limit the frequency; with a dozen tokens and an open
NFT section, a limit-based failure is likely.

**Recommendation:** Deduplication of identical requests in flight (cheap,
effective immediately) and batch eth_calls via JSON-RPC batch where
the node supports it.

### 4.4 Interface

Memoization is applied in 32 places; long lists are virtualized (`VirtualList`). The NFT list is not virtualized – with a limit
of 60 entries, this is justified.

Polling intervals: balances 30 sec, cache freshness 15 sec, transactions 12 sec,
rates 60 sec, ENS cache 5 min, new blocks 4 sec. Background refresh
stops when the tab is hidden.

---

## 5. Scalability

| Measurement | State |
| --- | --- |
| Number of Networks | No limit; data is split by `chainId` wherever it makes sense |
| Number of Accounts | HD tree, index-based generation; no lookup of occupied addresses during recovery (A-16) |
| Number of Tokens | Linear by requests, see 4.3 |
| Number of Transactions | **Bottleneck**, see 4.2 |
| Number of NFT Items | Hard limit of 60 checks at a time, displayed fairly to the user (A-118) |
| Porting to the MV3 extension | DOM-free core; the session maintains timers, which are different in service workers |
| Multi-tab support | Not tested: two tabs with the same IndexedDB storage may have different states |

Multi-tab support should be tested separately—it's not a theoretical risk,
but a common scenario: a wallet is open in two tabs, and a transfer is in progress in one.

---

## 6. Code Quality

| Metric | Value |
| --- | --- |
| `any` in production code | 0 |
| `@ts-ignore` / `@ts-expect-error` | 0 |
| Linter suppressions | 2, both with justification in a comment |
| `TODO` / `FIXME` / `HACK` | 0 |
| File length 500 строк | 15, из них боевых 8 |
| Покрытие операторов | 87.58 % |
| Покрытие ветвлений | 77.55 % |

Самое слабое покрытие ветвлений: `core/storage` 46.9 % (ветви ошибок
IndexedDB воспроизводятся тяжело), `features/dapp/ui` 51.9 %,
`core/provider` 66.5 %.

Комментарии объясняют **почему**, а не что: каждое неочевидное решение
сопровождается причиной и ценой альтернативы. Это повышает стоимость
правки «на автомате» и снижает риск, что защитная проверка будет снята
как лишняя.

### 6.1 Гигиена реестра долга (A-126, низкий)

Две записи в `TECH_DEBT.md` устарели и числятся открытыми, хотя работа
выполнена: **A-41** (экран NFT без источника данных) и **A-63** (история
не подставляет метаданные отслеживаемых токенов). Обе закрыты на этапе 26.

Реестр — рабочий инструмент; расхождение с действительностью обесценивает
его быстрее, чем отсутствие записей.

### 6.2 Кэш коллекций переживает блокировку (A-127, низкий)

`NftService.clear()` реализован, но не вызывается в `WalletSession.close()`
— в отличие от `EnsService.clearCache()`, который вызывается специально.
Названия коллекций не секрет, но несогласованность в правиле «сессия
уносит с собой всё, что накопила» стоит устранить.

---

## 7. Соответствие практикам кошельков

| Практика | Состояние |
| --- | --- |
| Ключи не покидают устройство | Да; бэкенд не получает ни фраз, ни ключей, ни подписей |
| Показанное совпадает с подписываемым | Да для отправки из кошелька; **нет** для развёртывания контракта из dApp (S-62) |
| Расшифровка вызова вместо голых байтов | Частично: `transfer`, `approve`, `safeTransferFrom`, `permit`; остальное честно помечается «смысл не разобран» |
| Предупреждение о неограниченном разрешении | Да, при выдаче |
| Отзыв выданных разрешений | **Нет** (S-54) |
| Проверка EIP-155 | Да |
| Проверка сети в EIP-712 | Да |
| Nonce с учётом мемпула | Да |
| Замена и отмена зависших | Да, надбавка 15 % к обеим частям комиссии |
| Слежение за судьбой транзакции | Да, с учётом реорганизации цепи и замещения |
| Ограничение попыток ввода пароля | Да, с растущей задержкой, переживающей перезагрузку |
| Автоблокировка | Да, 15 минут по умолчанию, с предупреждением |
| Повторный ввод пароля перед подписью | Да, включён по умолчанию |
| Резервное копирование с оценкой риска | Да, с журналом экспорта |
| Список проверенных контрактов | **Нет** (S-38) |
| Список фишинговых доменов | **Нет** |
| Аппаратные кошельки | **Нет**, точка расширения подготовлена |
| Симуляция транзакции | **Нет** |
| Интернационализация | Интерфейс целиком на английском; второго языка нет (этап 27) |
| Доступность | Иконочные кнопки подписаны, `prefers-reduced-motion` учтён; аудита контраста и порядка фокуса не проводилось |
| Устойчивость интерфейса к сбою | **Нет `ErrorBoundary`** (A-128): ошибка рендера даёт белый экран, что для владельца средств неотличимо от пропажи |

---

## 8. Что делать дальше

### Шаг 1. Закрыть дефект подписи (обязательно до любых сумм)

- **S-62** — развёртывание контракта из dApp: подписывать `to: null`
  либо отвергать запрос. Работы на час, включая тест, которого сегодня
  нет.

### Шаг 2. Безопасность средств

- **S-54** — управление разрешениями: список выданных `approve`
  и `setApprovalForAll` с отзывом. Читается через журналы `Approval`,
  проверяется вызовом `allowance`. Самый большой оставшийся разрыв.
- **S-63** — отвергать `eth_sign`.
- **S-38** — встроенный список проверенных токенов для основных сетей
  с пометкой «проверен» в интерфейсе.

### Шаг 3. Надёжность

- **A-128** — `ErrorBoundary` с экраном «что-то сломалось, средства
  на месте, вот как проверить в обозревателе».
- **A-124** — индекс истории транзакций; без него кошелёк деградирует
  тем сильнее, чем дольше им пользуются.
- Проверка многовкладочности.

### Шаг 4. Инженерная гигиена

- **I-3** — CI на `npm run verify` и `npm audit`. **Внешнего хранилища
  у проекта до сих пор нет: репозиторий существует в одном экземпляре
  на одном диске.** Это самый вероятный способ потерять всю работу.
- **A-122** — разделить `WalletSession` на фасады до следующей крупной
  возможности.
- **A-123** — выделить `core/abi`.
- **A-126**, **A-127** — привести реестр долга в соответствие,
  вызвать `NftService.clear()` при закрытии сессии.

### Шаг 5. Развитие

Аппаратные кошельки, симуляция транзакций, QR для WalletConnect (A-90),
завершение интернационализации (A-85), пагинация истории (A-71).

---

## 9. Что проверялось и как

| Область | Метод |
| --- | --- |
| Криптография | Чтение всех точек использования примитивов; поиск самописных реализаций |
| Хранение | Проверка, какие репозитории получают `ISecureStorage`, а какие — открытое хранилище |
| Подпись | Чтение сторожевых проверок `SigningService` |
| Путь dApp | Чтение разбора запросов, анализа рисков и исполнения; сверка показанного с подписываемым |
| Периметр браузера | Чтение CSP из собранного `index.html`; поиск `eval`, `innerHTML`, карт кода |
| Логи | Поиск PII и секретов в контексте вызовов логгера |
| Производительность хранилища | Замер на реальном шифровании, 100 и 500 записей |
| Размер сборки | `npm run build`, сжатие каждого файла начальной загрузки |
| Покрытие | `vitest --coverage` |
| Зависимости | `npm audit`, ручной просмотр прямых зависимостей |
| Слои | Правила ESLint и фактические импорты |
| Доступность | Поиск иконочных кнопок без подписи, `prefers-reduced-motion` |

**Чего аудит не проверял:** контраст цветовых пар, порядок обхода
фокуса, поведение в двух вкладках, работу на реальных мобильных
браузерах, устойчивость к вредоносному расширению в той же вкладке.
