import { describe, expect, it } from "vitest"
import { DEFAULT_OPTIONS, resolveOptions } from "../src/tui.js"

describe("resolveOptions", () => {
  it("uses the approved refresh defaults", () => {
    expect(DEFAULT_OPTIONS).toEqual({
      localRefreshMs: 10_000,
      remoteRefreshMs: 30_000,
    })
    expect(resolveOptions(undefined)).toEqual(DEFAULT_OPTIONS)
  })

  it("accepts finite positive integer overrides", () => {
    expect(resolveOptions({ localRefreshMs: 2_000, remoteRefreshMs: 60_000 })).toEqual({
      localRefreshMs: 2_000,
      remoteRefreshMs: 60_000,
    })
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1000"])(
    "rejects invalid interval %j",
    (value) => {
      expect(resolveOptions({ localRefreshMs: value }).localRefreshMs).toBe(10_000)
    },
  )
})
