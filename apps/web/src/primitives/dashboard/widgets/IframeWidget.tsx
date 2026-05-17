export function IframeWidget({ src, title }: { src: string; title?: string }) {
  return (
    <div className="h-full overflow-hidden rounded-md border border-border bg-bg">
      <iframe src={src} title={title ?? "embedded"} className="h-full w-full" />
    </div>
  );
}
