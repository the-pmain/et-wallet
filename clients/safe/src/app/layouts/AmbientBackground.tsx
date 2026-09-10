/**
 * Subdued background for the wallet's working screens.
 *
 * HOW IT DIFFERS FROM THE SIGN-IN BACKGROUND. Three things, and all
 * three are for readability, not for thrift:
 *
 * 1. Opacity is a third as high. Colour is present but does not
 *    compete with amounts and warnings for attention.
 * 2. Motion is four times slower — a period of about a minute and a
 *    half. That shift is noticed only if you look at empty space
 *    on purpose.
 * 3. No falling coins. A moving object behind a figure is the most
 *    distracting thing you can put on a screen where that figure
 *    is being read.
 *
 * WHY THIS IS HERE AT ALL. Dropping the background entirely produced
 * the other extreme: the working screen looked like a black sheet.
 * Between "gets in the way of reading" and "looks unfinished" there
 * is a middle, and that is the subdued background.
 *
 * `aria-hidden` is required: a screen reader has nothing to say
 * about a background, and extra nodes clutter page navigation.
 */
export function AmbientBackground() {
  return (
    <div className="aurora aurora-ambient" aria-hidden>
      <div className="aurora-blob aurora-blob-primary" />
      <div className="aurora-blob aurora-blob-secondary" />
      <div className="aurora-blob aurora-blob-accent" />

      <div className="aurora-grid" />
      <div className="aurora-vignette" />
    </div>
  )
}
