import fs from "node:fs";
import path from "node:path";

export default function globalSetup() {
  const testDataRoot = path.resolve(process.env.TEST_DATA_ROOT || "test-results/runtime-data");
  fs.rmSync(testDataRoot, { recursive: true, force: true });
}
