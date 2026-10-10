/* eslint-disable @next/next/no-img-element */
/** The Xpressbees logo. It sits on a small white tile so it stays readable in dark mode too. */
export default function Logo({ height = 30 }: { height?: number }) {
  return (
    <span className="logo">
      <img src="/xpressbees-logo.png" alt="Xpressbees" height={height} width={Math.round((477 / 80) * height)} style={{ height, width: "auto" }} />
    </span>
  );
}
