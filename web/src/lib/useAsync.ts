import { useEffect, useState } from "react";

/** The value a promise resolves to, re-requested when ``deps`` change; ``undefined`` while pending. */
export function useAsync<T>(load: () => Promise<T> | null, deps: unknown[]): { value?: T; error?: Error } {
  const [state, setState] = useState<{ value?: T; error?: Error }>({});
  useEffect(() => {
    let live = true;
    setState({});
    const pending = load();
    pending?.then(
      (value) => live && setState({ value }),
      (error: Error) => live && setState({ error }),
    );
    return () => {
      live = false;
    };
  }, deps);
  return state;
}
