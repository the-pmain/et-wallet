/**
 * Ставит адрес в тестовом окне так, как это делает настоящий переход.
 *
 * `BrowserRouter` читает `pathname`. Присвоение `location.hash` его
 * больше не двигает: это работало только с `HashRouter`.
 *
 * History API сам `popstate` не шлёт — событие возникает лишь при
 * кнопках «назад» и «вперёд». Без него смонтированный маршрутизатор
 * не узнает, что путь сменился.
 */
export function openPath(path: string): void {
  window.history.replaceState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
