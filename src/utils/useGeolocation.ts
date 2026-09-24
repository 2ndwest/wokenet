import { useEffect, useState } from "react";

// The viewer's [lat, lng] if they allow location access, else undefined. It never leaves the browser.
// Rounded to ~50m, so it only changes (and re-renders) once they've actually moved.
export const useGeolocation = () => {
  const [here, setHere] = useState<number[]>();
  useEffect(() => {
    const geo = navigator.geolocation;
    if (!geo) return;

    const round = (deg: number) => Math.round(deg / 0.0005) * 0.0005;
    const update = ({ coords }: GeolocationPosition) =>
      setHere((prev) => {
        const next = [round(coords.latitude), round(coords.longitude)];
        return prev && prev[0] === next[0] && prev[1] === next[1] ? prev : next;
      });
    const ignore = () => {}; // Denied or unavailable: stays undefined.

    const id = geo.watchPosition(update, ignore, { maximumAge: 60_000 });

    // The watch pauses in the background and doesn't always resume (especially in iOS home-screen
    // apps), so ask again whenever the page comes back into view.
    const onVisible = () => {
      if (document.visibilityState === "visible")
        geo.getCurrentPosition(update, ignore, { maximumAge: 30_000 });
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      geo.clearWatch(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return here;
};
