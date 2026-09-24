import { useEffect } from "react";

const IDLE_MS = 15_000;

// Hides the mouse cursor anywhere on the page once it's sat still for a few seconds (for the TV
// pages, where a stray cursor is left parked on the board). Any movement brings it back.
export const useIdleCursor = () => {
  useEffect(() => {
    const body = document.body;
    let timeout: ReturnType<typeof setTimeout>;
    const wake = () => {
      body.classList.remove("cursor-idle");
      clearTimeout(timeout);
      timeout = setTimeout(() => body.classList.add("cursor-idle"), IDLE_MS);
    };

    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("mousedown", wake);

    return () => {
      clearTimeout(timeout);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("mousedown", wake);
      body.classList.remove("cursor-idle");
    };
  }, []);
};
