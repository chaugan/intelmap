import { useMapStore } from '../../stores/useMapStore.js';
import ActivityBox from './ActivityBox.jsx';

export default function VesselActivityBox({ mapRef }) {
  const drawing = useMapStore((s) => s.vesselActivityDrawing);
  const setDrawing = useMapStore((s) => s.setVesselActivityDrawing);
  const box = useMapStore((s) => s.vesselActivityBox);
  const setBox = useMapStore((s) => s.setVesselActivityBox);

  return (
    <ActivityBox
      mapRef={mapRef}
      sourceId="vessel-activity-box"
      color="#06b6d4"
      maxSizeKm={100}
      drawing={drawing}
      setDrawing={setDrawing}
      box={box}
      setBox={setBox}
      tooLargeKey="vesselActivity.tooLarge"
    />
  );
}
