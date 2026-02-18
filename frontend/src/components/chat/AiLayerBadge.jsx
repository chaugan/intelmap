export default function AiLayerBadge({ layer }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-purple-600/30 text-purple-300 rounded">
      AI: {layer.name}
    </span>
  );
}
