import { useMapStore } from '../../stores/useMapStore.js';
import ActivityBox from './ActivityBox.jsx';

export default function AircraftActivityBox({ mapRef }) {
  const drawing = useMapStore((s) => s.aircraftActivityDrawing);
  const setDrawing = useMapStore((s) => s.setAircraftActivityDrawing);
  const box = useMapStore((s) => s.aircraftActivityBox);
  const setBox = useMapStore((s) => s.setAircraftActivityBox);

  return (
    <ActivityBox
      mapRef={mapRef}
      sourceId="aircraft-activity-box"
      color="#f59e0b"
      maxSizeKm={200}
      drawing={drawing}
      setDrawing={setDrawing}
      box={box}
      setBox={setBox}
      tooLargeKey="aircraftActivity.tooLarge"
    />
  );
}
