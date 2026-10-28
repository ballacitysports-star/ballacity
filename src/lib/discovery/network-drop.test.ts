import { describe, expect, it } from "vitest";
import { isNetworkDrop } from "./network-drop";

describe("isNetworkDrop", () => {
  it("recognises what each browser says when the connection dies", () => {
    expect(isNetworkDrop("Load failed")).toBe(true);
    expect(isNetworkDrop("Failed to fetch")).toBe(true);
    expect(isNetworkDrop("NetworkError when attempting to fetch resource.")).toBe(true);
    expect(isNetworkDrop("The network connection was lost.")).toBe(true);
  });

  it("does not retry a real answer from the server", () => {
    expect(isNetworkDrop("Web search failed (HTTP 404).")).toBe(false);
    expect(isNetworkDrop("This run's area is no longer configured.")).toBe(false);
    expect(isNetworkDrop("")).toBe(false);
    expect(isNetworkDrop(undefined)).toBe(false);
  });
});
