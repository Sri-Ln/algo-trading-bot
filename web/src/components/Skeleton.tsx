import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Brand } from "./StatusBar";

/** A placeholder block with a shimmer, sized like the content it stands in for. */
export function Bone({ w = "100%", h = 12, r = 4, style }: { w?: number | string; h?: number; r?: number; style?: CSSProperties }) {
  return <span className="bone" aria-hidden="true" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

/** True once ``active`` has stayed true for ``ms``, so quick loads never flash a loader. */
export function useDelayed(active: boolean, ms = 150): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) return setShown(false);
    const timer = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return shown;
}

/** Announces loading to screen readers while showing a skeleton. */
export function Loading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" className="skeleton">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Skeleton for a component's own data: nothing for the first 150 ms, then ``children``. */
export function Pending({ label, children }: { label: string; children: ReactNode }) {
  const show = useDelayed(true);
  return show ? <Loading label={label}>{children}</Loading> : <div style={{ minHeight: 24 }} />;
}

const WIDTHS = ["72%", "58%", "84%", "64%", "76%", "52%", "68%"];

export function TraceSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="trace">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="step">
          <Bone w={10} h={10} />
          <Bone w="11ch" />
          <span className="detail">
            <Bone w={WIDTHS[i % WIDTHS.length]} />
            {i % 2 === 1 && <Bone w="40%" h={8} />}
          </span>
          <Bone w="4ch" h={10} />
          <Bone w={10} h={10} r={5} />
        </div>
      ))}
    </div>
  );
}

export function LinesSkeleton({ rows = 4, gap = 10 }: { rows?: number; gap?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {Array.from({ length: rows }, (_, i) => (
        <Bone key={i} w={WIDTHS[i % WIDTHS.length]} />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 4, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-skeleton" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {Array.from({ length: cols }, (_, c) => (
        <Bone key={`h${c}`} w="50%" h={8} />
      ))}
      {Array.from({ length: rows * cols }, (_, i) => (
        <Bone key={i} w={WIDTHS[i % WIDTHS.length]} h={10} />
      ))}
    </div>
  );
}

/** The console's layout, drawn before its data arrives. */
export function PageSkeleton() {
  return (
    <Loading label="Loading the console">
      <div className="app">
        <header className="status">
          <Brand />
          {[90, 150, 130, 160, 120].map((w, i) => (
            <Bone key={i} w={w} h={14} />
          ))}
        </header>
        <nav className="side" aria-hidden="true">
          {[78, 84, 80, 44, 60].map((w, i) => (
            <span key={i} style={{ padding: "10px 10px" }}>
              <Bone w={w} h={12} />
            </span>
          ))}
        </nav>
        <main>
          <div className="tab-head">
            <Bone w={140} h={24} />
            <Bone w="min(60ch, 70%)" h={12} />
          </div>
          <div className="grid g4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card kpi">
                <Bone w="55%" h={9} />
                <Bone w="70%" h={24} />
                <Bone w="45%" h={9} />
              </div>
            ))}
          </div>
          <div className="grid g32">
            <div className="card">
              <Bone w="30%" h={9} />
              <TraceSkeleton />
            </div>
            <div className="card">
              <Bone w="25%" h={9} />
              <LinesSkeleton rows={5} />
            </div>
          </div>
          <div className="card">
            <Bone w="35%" h={9} />
            <Bone h={200} r={6} />
          </div>
        </main>
      </div>
    </Loading>
  );
}

export function ErrorCard({ message }: { message: string }) {
  return (
    <div className="app">
      <header className="status">
        <Brand />
      </header>
      <main style={{ gridColumn: "1 / -1" }}>
        <div className="card" role="alert">
          <h2>The console's data didn't load</h2>
          <p className="muted">{message}</p>
          <p>
            <button className="btn" onClick={() => location.reload()}>
              Try again
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
