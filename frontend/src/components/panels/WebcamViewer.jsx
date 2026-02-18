import { useEffect, useState } from 'react';
import { useWebcamStore } from '../../stores/useWebcamStore.js';

export default function WebcamViewer() {
  const camera = useWebcamStore((s) => s.selectedCamera);
  const setSelectedCamera = useWebcamStore((s) => s.setSelectedCamera);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!camera) return;
    const interval = setInterval(() => setRefresh(Date.now()), 60000);
    return () => clearInterval(interval);
  }, [camera]);

  if (!camera) return null;

  const id = camera.properties.id;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8">
      <div className="bg-slate-800 rounded-lg shadow-xl max-w-4xl w-full">
        <div className="flex justify-between items-center p-4 border-b border-slate-700">
          <h3 className="text-lg font-semibold text-emerald-400">{camera.properties.name}</h3>
          <button
            onClick={() => setSelectedCamera(null)}
            className="text-slate-400 hover:text-white text-xl"
          >
            ✕
          </button>
        </div>
        <div className="p-4">
          <img
            src={`/api/webcams/image/${id}?t=${refresh}`}
            alt={camera.properties.name}
            className="w-full h-auto rounded"
          />
        </div>
      </div>
    </div>
  );
}
