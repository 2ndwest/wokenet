import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import "./announcement.css";

// Announcements: when an admin shows one, it takes over the whole Putzopticon in letters as big as
// will fit, and stays up (there's no timeout) until an admin hides it again from the admin panel.

type Shown = { _id: string; text: string; details?: string } | null;

// The TV reloads itself every half hour and on every deploy. Until the server answers again, it
// keeps showing whatever was up before the reload, so an announcement never drops out.
const STORAGE_KEY = "putz-announcement";
const remembered = (): Shown => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
};

export const LiveAnnouncement = memo(() => {
  const live = useQuery(api.announcements.getLive);
  const [beforeReload] = useState(remembered);
  useEffect(() => {
    if (live === undefined) return;
    try {
      if (live) localStorage.setItem(STORAGE_KEY, JSON.stringify(live));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // No storage (private window): it just won't bridge reloads.
    }
  }, [live]);

  const shown = live === undefined ? beforeReload : live;
  if (!shown) return null;
  return <AnnouncementCard key={shown._id} text={shown.text} details={shown.details} />;
});

type CardProps = { text: string; details?: string; preview?: boolean };

// The headline as big as it'll go, with any smaller text (a few lines of details) as a caption
// underneath. `preview` draws it inside its parent (a TV-shaped box in the admin panel) instead of
// over the page.
export const AnnouncementCard = memo(({ text, details, preview = false }: CardProps) => {
  const column = useRef<HTMLDivElement>(null);
  const headline = useRef<HTMLParagraphElement>(null);
  const small = useRef<HTMLDivElement>(null);
  useFitText(column, headline, small, `${text}\n${details ?? ""}`);

  return (
    <div className="putz-announcement" data-preview={preview} role={preview ? undefined : "alert"}>
      <div ref={column} className="putz-announcement-column">
        <div className="putz-announcement-frame">
          {/* Typed line breaks are kept exactly (each line stays whole); otherwise it wraps to fit. */}
          <p ref={headline} className="putz-announcement-text" data-exact-lines={text.includes("\n")}>
            {text}
          </p>
        </div>
        {details && (
          // A line apiece, so each one wraps evenly on its own.
          <div ref={small} className="putz-announcement-details">
            {details
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line, i) => (
                <p key={i}>{line}</p>
              ))}
          </div>
        )}
      </div>
    </div>
  );
});

// The smaller text gets up to this share of the height, and is never bigger than this share of the
// width (so a short line doesn't balloon); the headline gets whatever is left.
const DETAILS_MAX_HEIGHT = 0.6;
const DETAILS_MAX_SIZE = 0.085;

// The biggest size `fits` allows, between `lo` and `hi`, left applied.
const biggest = (lo: number, hi: number, fits: (size: number) => boolean) => {
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  fits(Math.floor(lo));
};

// Sizes the text to fit without breaking words, refitting whenever the space resizes or the font
// finishes loading: the smaller text first, then the headline in the room left over.
const useFitText = (
  column: React.RefObject<HTMLElement | null>,
  headline: React.RefObject<HTMLElement | null>,
  small: React.RefObject<HTMLElement | null>,
  content: string
) => {
  useLayoutEffect(() => {
    const outer = column.current!;
    const fit = () => {
      const { clientWidth: width, clientHeight: height } = outer;
      if (!width || !height) return;
      const fitsAcross = (el: HTMLElement) => el.scrollWidth <= el.clientWidth + 1;

      const details = small.current;
      if (details) {
        biggest(4, Math.max(4, width * DETAILS_MAX_SIZE), (size) => {
          details.style.fontSize = `${size}px`;
          return fitsAcross(details) && details.offsetHeight <= height * DETAILS_MAX_HEIGHT;
        });
      }

      // The headline gets the rest (the column centers the two together, so if the headline runs out
      // of width first, the space it doesn't use is shared above and below rather than left in a gap).
      const words = headline.current!;
      const gap = parseFloat(getComputedStyle(outer).rowGap) || 0;
      const room = details ? height - details.offsetHeight - gap : height;
      biggest(4, Math.max(4, room), (size) => {
        words.style.fontSize = `${size}px`;
        return fitsAcross(words) && words.offsetHeight <= room;
      });
    };

    fit();
    let cancelled = false;
    document.fonts?.ready.then(() => !cancelled && fit());
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [column, headline, small, content]);
};
