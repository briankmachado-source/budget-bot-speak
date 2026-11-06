import { Sun, Cloud, CloudRain, CloudLightning, CloudFog, X, Droplets, Wind } from "lucide-react";
import type { Weather } from "@/lib/weather";

function WeatherIcon({ code, className }: { code: number; className?: string }) {
  if (code >= 95) return <CloudLightning className={className} />;
  if (code >= 51) return <CloudRain className={className} />;
  if (code >= 45) return <CloudFog className={className} />;
  if (code >= 2) return <Cloud className={className} />;
  return <Sun className={className} />;
}

export function WeatherCard({ w, onClose }: { w: Weather; onClose: () => void }) {
  // Tarjeta de clima: se muestra arriba del asistente de voz en index.tsx
  return (
    <div className="relative rounded-3xl border bg-card p-6">
      <button onClick={onClose} aria-label="Cerrar clima" className="absolute right-4 top-4 text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
      <p className="text-xs text-muted-foreground">Clima de hoy</p>
      <h2 className="text-lg font-semibold">
        {w.city}
        {w.region && <span className="font-normal text-muted-foreground"> · {w.region}</span>}
      </h2>
      <div className="mt-4 flex items-center gap-5">
        <WeatherIcon code={w.code} className="h-14 w-14 text-primary" />
        <div>
          <p className="font-display text-5xl font-bold tabular-nums leading-none">{w.temp}°</p>
          <p className="mt-1 text-sm text-muted-foreground">{w.condition}</p>
        </div>
        <div className="ml-auto space-y-1 text-right text-sm tabular-nums">
          <p>Máx {w.max}° · Mín {w.min}°</p>
          <p className="flex items-center justify-end gap-1 text-muted-foreground"><Droplets className="h-3.5 w-3.5" /> {w.rainChance ?? "–"}% lluvia · {w.humidity}% hum.</p>
          <p className="flex items-center justify-end gap-1 text-muted-foreground"><Wind className="h-3.5 w-3.5" /> {w.wind} km/h</p>
        </div>
      </div>
    </div>
  );
}
