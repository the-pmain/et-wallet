/**
 * Sets the address in the test window the way a real navigation does.
 *
 * `BrowserRouter` reads `pathname`. Assigning `location.hash` no
 * longer moves it: that only worked with `HashRouter`.
 *
 * The History API does not fire `popstate` on its own — the event
 * only comes from the back and forward buttons. Without it a
 * mounted router will not learn that the path changed.
 */
export function openPath(path: string): void {
  window.history.replaceState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
