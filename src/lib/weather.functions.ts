import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getWeather } from "./weather.server";

export const fetchWeather = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ city: z.string().min(1).max(80) }).parse(d))
  .handler(async ({ data }) => getWeather(data.city).catch(() => null));
