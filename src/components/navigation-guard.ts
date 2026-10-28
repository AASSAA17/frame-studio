"use client";
type GuardWindow = Window & {
  __frameHistoryTracked?: boolean;
  __framePopGuards?: Set<(event: PopStateEvent) => void>;
  navigation?: { currentEntry?: { index: number } | null };
};

function popGuards() {
  const target = window as GuardWindow;
  if (!target.__framePopGuards) {
    const guards = new Set<(event: PopStateEvent) => void>();
    target.__framePopGuards = guards;
    // Register before Next installs its router listener during hydration.
    // Window is the event target: a later component listener can be removed by
    // the router's synchronous unmount before it has a chance to reject Back.
    window.addEventListener(
      "popstate",
      (event) => {
        for (const guard of [...guards]) {
          guard(event);
          if (event.cancelBubble) break;
        }
      },
      true,
    );
  }
  return target.__framePopGuards;
}

if (typeof window !== "undefined") popGuards();

export function subscribeFramePopGuard(guard: (event: PopStateEvent) => void) {
  const guards = popGuards();
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}
export function frameHistoryPosition(): number | null {
  const nativeIndex = (window as GuardWindow).navigation?.currentEntry?.index;
  if (typeof nativeIndex === "number" && nativeIndex >= 0) return nativeIndex;
  return typeof history.state?.__framePosition === "number"
    ? (history.state.__framePosition as number)
    : null;
}
export function installFrameHistoryTracking() {
  const target = window as GuardWindow;
  // Next owns history.state. Modern browsers already expose the current entry's
  // index, so no wrapper or synthetic navigation is needed for Back/Forward.
  if (target.navigation?.currentEntry) return;
  if (target.__frameHistoryTracked) return;
  target.__frameHistoryTracked = true;
  const push = history.pushState.bind(history),
    replace = history.replaceState.bind(history);
  replace(
    { ...history.state, __framePosition: frameHistoryPosition() ?? 0 },
    "",
    location.href,
  );
  history.pushState = (state, title, url) =>
    push(
      { ...state, __framePosition: (frameHistoryPosition() ?? 0) + 1 },
      title,
      url,
    );
  history.replaceState = (state, title, url) =>
    replace(
      {
        ...state,
        __framePosition:
          typeof state?.__framePosition === "number"
            ? state.__framePosition
            : (frameHistoryPosition() ?? 0),
      },
      title,
      url,
    );
}
