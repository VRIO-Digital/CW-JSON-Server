/*
 * A standalone HTML document, served at a memorable path.
 *
 * `public/context-weave-settings-users-connectors-use-description.html` is a complete document — its own
 * `<html>`, its own `<style>` — and Vite already serves it under its own long filename. This gives it the
 * short path somebody can type, `/login/data`, without moving the file or rewriting it.
 *
 * **An iframe, not inlined markup.** The document sets bare `*`, `body` and heading rules, so pasting its
 * body into the app would restyle every page it touched — precisely the trap the vendored report
 * stylesheet had to be scoped out of, and an iframe is the version of that fix with no caveats. It also
 * keeps the document exactly as authored: nothing here reformats or reinterprets it.
 *
 * **Outside `App` and outside `RequireAuth`.** Outside `App` because it is a document rather than a page
 * of the console — the sidebar and the shell would frame something that already has its own header. And
 * outside `RequireAuth` because the whole point is that the path can be typed and read; sitting behind the
 * gate, an unauthenticated visit would bounce to `/login` and the document would never appear. Nothing on
 * it is tenant data, which is what makes that safe.
 */
export default function StaticDocPage({
  /** Relative to the site root. `BASE_URL` so a build served under a sub-path still resolves it. */
  file,
  title,
}: {
  file: string
  title: string
}) {
  const src = `${import.meta.env.BASE_URL}${file}`

  return (
    <iframe
      src={src}
      title={title}
      /*
       * Fills the window: the document brings its own layout, so anything less would letterbox it inside
       * a page that has no other content. `border: 0` because an iframe's default frame reads as a seam.
       */
      style={{ display: 'block', width: '100%', height: '100vh', border: 0 }}
    />
  )
}
